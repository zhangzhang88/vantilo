#!/usr/bin/env python3
"""Isolated benchmark of *existing* local-qwen-api MLX runtime.

No network, no API keys, no downloads. Model directory and project are read-only.
Run with the local-qwen-api Python virtualenv; JSON output stays in ignored build/.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

def explain_prompt(case: dict, task: str) -> str:
    if task == "reader-json":
        return (
            "你在帮助中国读者理解英文文章里的一个单词。只针对当前句子中的词义，不列出无关义项。\n"
            "只输出有效 JSON 对象，必须恰好包含这些键："
            "meaningZh, explanationZh, meaningEn, explanationEn, examplesEn, partOfSpeech。\n"
            "meaningZh: 当前语境下2-8字中文意思；explanationZh: 1句话中文解释为何此义合适；"
            "meaningEn: 简短英文释义；explanationEn: 一句话英文解释；"
            "examplesEn: 必须是严格的 JSON 字符串数组，恰好有两个独立元素，绝不能用一个字符串加换行代替数组；"
            "partOfSpeech: 英语词性简写，如verb、noun。\n"
            "请严格按此格式返回并替换全部示例值："
            '{"meaningZh":"中文短义","explanationZh":"解释","meaningEn":"English gloss",'
            '"explanationEn":"English rationale","examplesEn":["First example.","Second example."],'
            '"partOfSpeech":"verb"}\n'
            f"目标词：{case['word']}\n原句：{case['sentence']}"
        )

    return (
        "任务：解释英语单词在所给句子中的具体中文意思。只解释被问到的单词，不翻译整句。\n"
        "请用简体中文，只输出一行：释义：<2至8个汉字>；依据：<不超过25个汉字的简要说明>。\n"
        "不引用外部资料，不需要额外分析过程。\n"
        f"单词：{case['word']}\n句子：{case['sentence']}"
    )

async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--task", choices=["short", "reader-json"], default="short")
    args = parser.parse_args()
    if not (1 <= args.limit <= 20):
        parser.error("--limit must be from 1 to 20")
    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    if not isinstance(cases, list) or len(cases) != 20:
        parser.error("expected 20 synthetic benchmark cases")
    if not args.runtime_root.joinpath("app/model_runtime.py").is_file():
        parser.error("local-qwen-api runtime source not found")
    sys.path.insert(0, str(args.runtime_root))
    from app.model_runtime import ModelRuntime

    benchmark = {
        "provider": "local-qwen-mlx",
        "task": args.task,
        "model": args.model.name,
        "case_count": args.limit,
        "first_token_latency_ms": None,
        "first_token_note": "Existing ModelRuntime.generate only returns after generation; first-token timing is not instrumented.",
        "load_ms": None,
        "results": [],
        "summary": None,
    }
    runtime = ModelRuntime(args.model)
    start_load = time.perf_counter()
    await runtime.ensure_loaded()
    benchmark["load_ms"] = round((time.perf_counter() - start_load) * 1000, 1)
    print(f"Loaded {args.model.name}: {benchmark['load_ms']}ms", flush=True)

    for index, case in enumerate(cases[:args.limit], 1):
        prompt = explain_prompt(case, args.task)
        messages = [{"role": "system", "content": "你是简洁的英语词典语境释义助手。"},
                    {"role": "user", "content": prompt}]
        start = time.perf_counter()
        try:
            response = await runtime.generate(messages, temperature=0.0, max_tokens=270 if args.task == "reader-json" else 85)
            elapsed = round((time.perf_counter() - start) * 1000, 1)
            text = response.text.strip()
            valid_reader_json = None
            json_parse_ok = None
            reader_json_issues = []
            if args.task == "reader-json":
                try:
                    parsed = json.loads(text)
                    json_parse_ok = True
                    keys = {"meaningZh", "explanationZh", "meaningEn", "explanationEn", "examplesEn", "partOfSpeech"}
                    if not isinstance(parsed, dict):
                        reader_json_issues.append("not_object")
                    else:
                        for key in sorted(keys - {"examplesEn"}):
                            if not isinstance(parsed.get(key), str) or not parsed[key].strip():
                                reader_json_issues.append("missing_or_empty:" + key)
                        examples = parsed.get("examplesEn")
                        if not isinstance(examples, list) or len(examples) < 2:
                            reader_json_issues.append("examples_not_array_of_two")
                        elif not all(isinstance(s, str) and s.strip() for s in examples):
                            reader_json_issues.append("examples_invalid_element")
                    valid_reader_json = not reader_json_issues
                except (ValueError, TypeError):
                    json_parse_ok = False
                    valid_reader_json = False
                    reader_json_issues.append("invalid_json")
            record = {
                "reader_json_valid": valid_reader_json,
                "json_parse_ok": json_parse_ok,
                "reader_json_issues": reader_json_issues,
                "index": index, "word": case["word"], "sentence": case["sentence"],
                "reference_sense": case["expected"], "answer": text,
                "total_ms": elapsed, "tokens": response.completion_tokens,
                "token_limit_reached": bool(args.task == "reader-json" and response.completion_tokens >= 270),
                "seconds_in_engine": round(response.generation_seconds, 3),
                "error": None,
            }
            print(f"[{index}/{args.limit}] {case['word']}: {elapsed:.1f}ms, {response.completion_tokens} tokens, answer={text[:95]!r}", flush=True)
        except Exception as exc:
            record = {"index": index, "word": case["word"], "sentence": case["sentence"],
                      "reference_sense": case["expected"], "answer": None,
                      "total_ms": round((time.perf_counter() - start) * 1000, 1),
                      "tokens": None, "error": type(exc).__name__}
            print(f"[{index}/{args.limit}] {case['word']}: ERROR {type(exc).__name__}", flush=True)
        benchmark["results"].append(record)
        # Atomic checkpoint after each test; no user data involved.
        args.output.parent.mkdir(parents=True, exist_ok=True)
        tmp = args.output.with_suffix(".tmp")
        tmp.write_text(json.dumps(benchmark, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(args.output)

    good = [r["total_ms"] for r in benchmark["results"] if r["error"] is None]
    if good:
        benchmark["summary"] = {
            "successful": len(good),
            "avg_ms": round(statistics.mean(good), 1),
            "median_ms": round(statistics.median(good), 1),
            "min_ms": min(good), "max_ms": max(good),
        }
    tmp = args.output.with_suffix(".tmp")
    tmp.write_text(json.dumps(benchmark, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(args.output)
    print("SUMMARY " + json.dumps(benchmark["summary"]), flush=True)

if __name__ == "__main__":
    asyncio.run(main())