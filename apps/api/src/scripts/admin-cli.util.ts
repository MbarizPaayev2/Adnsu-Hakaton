import { createInterface } from 'readline';

/**
 * Reads a line from the terminal without echoing it (passwords never go
 * through argv, environment variables or shell history). When stdin is not a
 * TTY (e.g. piped from a secrets manager) the line is read as-is.
 */
let pipedLines: Promise<string[]> | null = null;

/** Non-TTY input is read once and handed out line by line across prompts. */
async function nextPipedLine(): Promise<string> {
  if (!pipedLines) {
    pipedLines = new Promise((resolve) => {
      const lines: string[] = [];
      const rl = createInterface({ input: process.stdin });
      rl.on('line', (l) => lines.push(l));
      rl.on('close', () => resolve(lines));
    });
  }
  const lines = await pipedLines;
  const line = lines.shift();
  if (line === undefined) throw new Error('Input ended before all answers were given; nothing was changed.');
  return line;
}

export async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return nextPipedLine();
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          return reject(new Error('Cancelled'));
        }
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

export async function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write(question + '\n');
    return (await nextPipedLine()).trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
}

export async function newPasswordTwice(): Promise<string> {
  const first = await promptHidden('New password (min 12 chars): ');
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new Error('Passwords do not match');
  if (first.length < 12) throw new Error('Password must be at least 12 characters');
  return first;
}

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
