import path from 'node:path';
import {fileURLToPath} from 'node:url';

// All Reader code and build dependencies are owned by Vantilo's npm workspace.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readerSourceRoot = path.join(repository, 'packages', 'reader');
