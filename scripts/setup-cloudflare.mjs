import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const configPath = resolve(rootDir, "worker/wrangler.jsonc");
const frontendConfigPath = resolve(rootDir, "docs/config.js");
const databaseName = "luggage-planner-db";
const bindingName = "DB";
const workerName = "luggage-planner-api";

main();

function main() {
  console.log("\nPackwise Cloudflare setup\n");
  console.log(`Worker:  ${workerName}`);
  console.log(`D1 DB:   ${databaseName}\n`);

  ensureAuthenticated();

  let databases = listDatabases();
  let database = databases.find((entry) => entry.name === databaseName);

  if (!database) {
    console.log(`Creating D1 database ${databaseName} in Western North America…`);
    runWrangler([
      "d1", "create", databaseName,
      "--location", "wnam",
      "--config", configPath
    ], { inherit: true });
    databases = listDatabases();
    database = databases.find((entry) => entry.name === databaseName);
  } else {
    console.log(`Using existing D1 database ${databaseName}.`);
  }

  if (!database) {
    throw new Error(`Cloudflare did not return the database ${databaseName} after creation.`);
  }

  updateWranglerBinding(database);

  console.log("Applying D1 migrations…");
  runWrangler(["d1", "migrations", "apply", bindingName, "--remote", "--config", configPath], { inherit: true });

  const accessToken = process.env.APP_ACCESS_TOKEN?.trim() || randomBytes(24).toString("base64url");

  console.log("Deploying Worker…");
  const deploy = runWrangler(["deploy", "--config", configPath], { capture: true });
  process.stdout.write(deploy.stdout);
  process.stderr.write(deploy.stderr);

  const combined = `${deploy.stdout}\n${deploy.stderr}`;
  const workerUrl = combined.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/)?.[0] || "";
  if (workerUrl) {
    writeFileSync(
      frontendConfigPath,
      `window.LUGGAGE_APP_CONFIG = {\n  apiBaseUrl: ${JSON.stringify(workerUrl)}\n};\n`,
      "utf8"
    );
    console.log(`\nUpdated docs/config.js with ${workerUrl}`);
  } else {
    console.warn("\nThe Worker deployed, but its workers.dev URL could not be detected. Enter it in docs/config.js or in the dashboard's Connection settings.");
  }

  console.log("Setting Worker secret APP_ACCESS_TOKEN…");
  runWrangler(["secret", "put", "APP_ACCESS_TOKEN", "--config", configPath], { input: `${accessToken}\n`, inherit: true });

  console.log("\nSetup complete.");
  console.log("Store this access token securely; it is required when opening the dashboard:");
  console.log(`\n${accessToken}\n`);
  console.log("Commit the updated worker/wrangler.jsonc and docs/config.js files before pushing to GitHub.");
  console.log("For automatic future Worker deployments, add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as GitHub repository secrets.\n");
}

function ensureAuthenticated() {
  const result = spawnSync(wranglerCommand(), [...wranglerPrefix(), "whoami"], {
    cwd: rootDir,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    console.error(result.stdout || "");
    console.error(result.stderr || "");
    throw new Error("Wrangler is not authenticated. Run `npx wrangler login` and then run `npm run cf:setup` again.");
  }
}

function listDatabases() {
  const result = runWrangler(["d1", "list", "--json", "--config", configPath], { capture: true });
  const parsed = parseJsonArrayFromWrangler(result.stdout, result.stderr);
  if (!parsed) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(`Could not parse D1 database list from Wrangler output:\n${output}`);
  }
  return parsed;
}

function parseJsonArrayFromWrangler(...outputs) {
  // Wrangler can print warnings alongside --json output. Try each stream as-is
  // first, then locate a balanced JSON array while ignoring brackets in strings.
  for (const output of outputs) {
    const trimmed = output.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Continue with balanced-array extraction below.
    }
  }

  const combined = outputs.filter(Boolean).join("\n");
  for (let start = combined.indexOf("["); start !== -1; start = combined.indexOf("[", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < combined.length; index += 1) {
      const char = combined[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(combined.slice(start, index + 1));
            if (Array.isArray(parsed)) return parsed;
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

function updateWranglerBinding(database) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const databaseId = database.uuid || database.id;
  if (!databaseId) throw new Error("The D1 database record did not include a UUID.");
  config.d1_databases = [{
    binding: bindingName,
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: "migrations"
  }];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`Bound ${databaseName} to env.${bindingName}.`);
}

function runWrangler(args, options = {}) {
  const result = spawnSync(wranglerCommand(), [...wranglerPrefix(), ...args], {
    cwd: rootDir,
    input: options.input,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: options.inherit && !options.capture ? [options.input ? "pipe" : "inherit", "inherit", "inherit"] : "pipe"
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Wrangler command failed: npx wrangler ${args.join(" ")}`);
  }
  return { stdout: result.stdout || "", stderr: result.stderr || "" };
}

function wranglerCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function wranglerPrefix() {
  return ["wrangler"];
}
