// EPUBs are user data, not source/build inputs. Existing userData libraries are never copied, removed or reset here.
if (process.argv.includes('--install-local')) {
  throw new Error('本地书库初始化已停用；请在 Reader 中导入 EPUB。现有 reader-library 数据保持不变。');
}
console.log('No personal EPUBs are bundled. Import books through the Reader; existing userData libraries are untouched.');
