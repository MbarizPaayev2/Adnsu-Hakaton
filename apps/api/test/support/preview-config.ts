/** Coordinates of the local preview (see preview-stack.ts). The founder's own preview (3450/4010/4598, aise_local_preview_20261003) is never used. */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PREVIEW_PORTS = { web: 3470, api: 4440, control: 4450, sink: 4631 };
export const PREVIEW_DB = 'aise_preview_20261004';
export const PREVIEW_PREFIX = 'aise-preview';
/** Runtime files (state, secrets, credentials, logs, uploads) live outside git. */
export const previewHome = process.env.AISE_PREVIEW_HOME || join(homedir(), 'aise-preview');
