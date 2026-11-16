// Logs what hardware a CI job ran on, to the log and the run's summary page,
// so slow runs can be compared against the machine they got.
import { appendFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";

const cores = cpus();
const line = `${process.env.JOB_LABEL ?? "job"}: ${cores[0]?.model.trim() ?? "unknown CPU"}, ${cores.length} cores, ${(totalmem() / 2 ** 30).toFixed(1)} GiB`;
console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
