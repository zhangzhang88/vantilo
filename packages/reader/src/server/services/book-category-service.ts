import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isBookCategoryId, type BookCategoryId } from "../../shared/book-category.js";

export class BookCategoryService {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async assignments(): Promise<Record<string, BookCategoryId>> {
    let raw: string;
    try { raw = await readFile(this.filePath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed.books || typeof parsed.books !== "object" || Array.isArray(parsed.books)
      || Object.entries(parsed.books).some(([id, category]) => !id.startsWith("book:") || !isBookCategoryId(category))) {
      throw new Error("书籍分类文件格式无效，请恢复后重试。");
    }
    return parsed.books;
  }

  set(bookId: string, categoryId: BookCategoryId): Promise<void> {
    if (!bookId.startsWith("book:") || !isBookCategoryId(categoryId)) return Promise.reject(new Error("无效的书籍分类。"));
    const task = this.queue.then(async () => {
      const books = await this.assignments();
      books[bookId] = categoryId;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, books }, null, 2), { flag: "wx" });
        await rename(temporary, this.filePath);
      } finally { await rm(temporary, { force: true }); }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
