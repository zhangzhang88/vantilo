import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Reader is a separate source project. An explicit override supports checkouts
// elsewhere; the default is a sibling of the Vantilo repository.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readerSourceRoot = path.resolve(process.env.VANTILO_MAGAZINE_READER_ROOT || path.join(repository, '..', 'magazine-reader'));
