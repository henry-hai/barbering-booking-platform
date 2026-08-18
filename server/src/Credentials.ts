/*
 * Bridges environment-supplied credentials to the two files this server reads
 * from disk.
 *
 * Locally, server/serverInfo.json and server/serviceAccount.json are real
 * files that git ignores. A deployed host has no such files and no safe way to
 * get them there, so both are supplied as environment variables instead and
 * written to their expected paths at startup.
 *
 * Doing it this way rather than teaching each reader about the environment is
 * deliberate. Appointments.ts hands the key file's path to google.auth
 * .GoogleAuth and must not change: it is the file that reads and writes the
 * A..L sheet layout, and the whole booking pipeline is pinned to it. Materializing the
 * file leaves that module identical on every host.
 *
 * An existing file always wins. A machine that already has real credentials on
 * disk keeps using them, so this is inert in local development.
 *
 * NOTHING HERE IS A SECRET. The values live in the host's environment; this
 * module only moves them into place.
 */

import fs from "fs";
import path from "path";

/* Both resolve relative to server/, one level up from dist/ at runtime. */
const SERVER_INFO_PATH = path.join(__dirname, "../serverInfo.json");
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "../serviceAccount.json");

export interface IMaterializeResult {
  /* Where the file ended up, for logging. */
  target: string;
  /* What happened: the file was already there, it was written from the
     environment, or neither source was available. */
  outcome: "existing" | "written" | "absent";
}

/*
 * Writes `value` to `target` unless a file is already there.
 *
 * The value is parsed as JSON before being written. Both consumers run
 * JSON.parse on what they read, and a malformed variable pasted into a host
 * dashboard is far easier to diagnose here, at startup, than as a parse error
 * from somewhere deeper later on.
 */
export function materialize(
  target: string,
  value: string | undefined,
  label: string
): IMaterializeResult {
  if (fs.existsSync(target)) { return { target, outcome: "existing" }; }

  const raw = (value ?? "").trim();
  if (raw === "") { return { target, outcome: "absent" }; }

  try {
    JSON.parse(raw);
  } catch (inError) {
    throw new Error(
      `${label} is set but is not valid JSON. Paste the whole file contents, ` +
      `including the outer braces. Parser said: ${(inError as Error).message}`
    );
  }

  /* 0600: readable by the process that needs it and nothing else. */
  fs.writeFileSync(target, raw, { encoding: "utf8", mode: 0o600 });
  return { target, outcome: "written" };
}

/*
 * Materializes both credential files. Call this before anything imports
 * ServerInfo, which reads serverInfo.json at module load.
 *
 * Nothing throws when a variable is missing. The server is allowed to run
 * without the sheets key -- Appointments.ts returns an empty list when it
 * cannot read -- and a missing serverInfo.json produces a clearer failure from
 * ServerInfo itself.
 */
export function materializeCredentials(
  env: NodeJS.ProcessEnv = process.env
): IMaterializeResult[] {
  const results = [
    materialize(SERVER_INFO_PATH, env.SERVER_INFO_JSON, "SERVER_INFO_JSON"),
    materialize(
      SERVICE_ACCOUNT_PATH,
      env.GOOGLE_SERVICE_ACCOUNT_JSON,
      "GOOGLE_SERVICE_ACCOUNT_JSON"
    )
  ];

  for (const result of results) {
    if (result.outcome === "written") {
      console.log(`Wrote ${path.basename(result.target)} from the environment.`);
    }
  }

  return results;
}
