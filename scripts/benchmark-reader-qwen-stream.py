#!/usr/bin/env python3
"""Optional TTFT measurement: MLX stream_generate, *not* the existing API path."""
import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path


async def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    sys.path.insert(0, str(args.runtime_root))
    from app.model_runtime import ModelRuntime
    from mlx_lm import stream_generate
    from mlx_lm.generate import make_sampler

    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    runtime = ModelRuntime(args.model)
    load_start = time.perf_counter()
    await runtime.ensure_loaded()
    load_ms = round((time.perf_counter() - load_start) * 1000, 1)
    results = []
    for case in cases[:args.limit]:
        prompt = (
            "任务：解释英语单词在所给句子中的具体中文意思。只解释被问到的单词，不翻译整句。\n"
            "请用简体中文，只输出一行：释义：<2至8个汉字>；依据：<不超过25个汉字的简要说明>。\n"
            "不引用外部资料，不需要额外分析过程。\n"
            f"单词：{case['word']}\n句子：{case['sentence']}"
        )
        rendered = runtime._render_prompt([
            {"role": "system", "content": "你是简洁的英语词典语境释义助手。"},
            {"role": "user", "content": prompt},
        ])
        t0 = time.perf_counter()
        first_ms = None
        latest = None
        for latest in stream_generate(
            model=runtime._model, tokenizer=runtime._tokenizer,
            prompt=rendered, max_tokens=85, sampler=make_sampler(temp=0.0)
        ):
            if first_ms is None:
                first_ms = round((time.perf_counter() - t0) * 1000, 1)
        total_ms = round((time.perf_counter() - t0) * 1000, 1)
        record = {
            "word": case["word"], "reference_sense": case["expected"],
            "first_token_ms": first_ms, "total_ms": total_ms,
            "tokens": latest.generation_tokens if latest else 0,
            "answer": latest.text.strip() if latest else "",
        }
        results.append(record)
        print(f"{case['word']}: TTFT={first_ms}ms total={total_ms}ms", flush=True)
    result = {
        "provider": "local-qwen-mlx-direct-stream",
        "note": "Hypothetical streaming MLX path, not current local-qwen-api (stream=true is rejected).",
        "load_ms": load_ms, "results": results,
        "median_ttft_ms": round(statistics.median(r["first_token_ms"] for r in results), 1),
        "median_total_ms": round(statistics.median(r["total_ms"] for r in results), 1),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUMMARY " + json.dumps({k:result[k] for k in ("load_ms","median_ttft_ms","median_total_ms")}),flush=True)

if __name__ == "__main__":
    asyncio.run(run())
