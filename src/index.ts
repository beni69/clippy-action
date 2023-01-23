import { debug, endGroup, getInput, startGroup, warning } from "@actions/core";
import { exec } from "@actions/exec";
import { context, getOctokit } from "@actions/github";
import { which } from "@actions/io";

interface Check {
    name: string;
    head_sha: string;
    status: "completed";
    started_at: string;
    completed_at: string;
    conclusion: "success" | "failure";
    output: {
        title: string;
        summary: string;
        // text: string; // TODO
        annotations: Clippy[];
    };
}
interface Clippy {
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: "notice" | "warning" | "failure";
    message: string;
    title: string;
}

const clippyArgs = getInput("args"),
    token = getInput("token", { required: true });

const hasClippy = async () => !!(await which("cargo-clippy", false));
if (!(await hasClippy())) {
    warning("clippy not found, installing...");
    await exec("rustup", ["component", "add", "clippy"]);
}
if (!(await hasClippy())) {
    throw new Error("clippy not found");
}

const out: Clippy[] = [],
    started_at = new Date().toISOString();
startGroup("clippy");
await exec("cargo-clippy", ["-q", "--message-format=json"], {
    listeners: {
        stdout: data =>
            data
                .toString()
                .trim()
                .split("\n")
                .map(s => {
                    const b = JSON.parse(s),
                        span = b.message?.spans?.find((s: any) => s.is_primary);
                    b.reason === "compiler-message" &&
                        span &&
                        out.push({
                            path: span.file_name,
                            start_line: span.line_start,
                            end_line: span.line_end,
                            annotation_level: b.message.level,
                            message: b.message.rendered,
                            title: b.message.message,
                        });
                }),
    },
});
endGroup();

debug(JSON.stringify(out, null, 2));

const check: Check = {
    name: "clippy",
    head_sha: context.sha,
    status: "completed",
    started_at,
    completed_at: new Date().toISOString(),
    conclusion: out.some(c => c.annotation_level === "failure")
        ? "failure"
        : "success",
    output: {
        title: "Clippy",
        summary: out.length ? "Found some issues" : "No issues found",
        annotations: out,
    },
};

const octokit = getOctokit(token);
const res = await octokit.request("POST /repos/{owner}/{repo}/check-runs", {
    ...context.repo,
    ...check,
});
debug(JSON.stringify(res, null, 2));
