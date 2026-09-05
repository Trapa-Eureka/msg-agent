// User-facing wording for config/secret problems: cause + fix, in ko/en.
// T8 will fold this into the phrase pack; keep every string here, never inline in the pipeline.
import type { ConfigIssue } from "./config.js";

export type MessageLang = "ko" | "en";

export type ConfigError =
  | { kind: "not_found"; path: string }
  | { kind: "unreadable"; path: string; detail: string }
  | { kind: "invalid_json"; path: string; detail: string }
  | { kind: "invalid"; path: string; issues: ConfigIssue[] };

export type SecretError =
  | { kind: "malformed_ref"; field: string }
  | { kind: "env_missing"; field: string; varName: string }
  | { kind: "empty"; field: string };

export interface Explanation {
  cause: string;
  fix: string;
}

const INIT_CMD = "npm run cli -- init";

function issueKo(i: ConfigIssue): Explanation {
  const d = i.detail ?? "";
  switch (i.code) {
    case "missing_field":
      return {
        cause: `필수 설정 '${i.path}'이(가) 없습니다.`,
        fix: `${INIT_CMD} 를 다시 실행해 설정을 채우세요.`,
      };
    case "invalid_lang":
      return {
        cause: `'${i.path}' 값 '${d}'은(는) 언어 코드가 아닙니다.`,
        fix: "ISO 639 코드를 사용하세요 (예: ko, en, ja, fil). 언어 이름으로 고르려면 init을 다시 실행하세요.",
      };
    case "invalid_secret_ref":
      return {
        cause: `'${i.path}' 형식이 잘못되었습니다.`,
        fix: "'env:VAR_NAME'(.env 또는 셸 환경변수) 또는 'literal:값' 형태여야 합니다. 예: env:ANTHROPIC_API_KEY",
      };
    case "invalid_mode":
      return {
        cause: `'${i.path}' 값 '${d}'은(는) 지원하지 않는 모드입니다.`,
        fix: "smart, full, summary 중 하나로 바꾸세요.",
      };
    case "invalid_kind":
      return {
        cause: `'${i.path}' 값 '${d}'은(는) 지원하지 않습니다.`,
        fix: "provider.kind는 claude|openai, messenger.kind는 telegram 이어야 합니다.",
      };
    case "invalid_number":
      return {
        cause: `'${i.path}' 값 '${d}'은(는) 양의 정수가 아닙니다.`,
        fix: "1 이상의 정수를 넣으세요 (예: 3000).",
      };
    case "threshold_over_max":
      return {
        cause: "inlineThresholdChars가 maxChars보다 큽니다.",
        fix: "inlineThresholdChars를 maxChars 이하로 낮추거나 maxChars를 올리세요.",
      };
    case "invalid_value":
      return {
        cause: `'${i.path}' 값이 올바르지 않습니다 (${d}).`,
        fix: `${INIT_CMD} 를 다시 실행하거나 config.json을 수정하세요.`,
      };
  }
}

function issueEn(i: ConfigIssue): Explanation {
  const d = i.detail ?? "";
  switch (i.code) {
    case "missing_field":
      return {
        cause: `Required setting '${i.path}' is missing.`,
        fix: `Run ${INIT_CMD} again to fill it in.`,
      };
    case "invalid_lang":
      return {
        cause: `'${i.path}' value '${d}' is not a language code.`,
        fix: "Use an ISO 639 code (e.g. ko, en, ja, fil). Re-run init to pick a language by name.",
      };
    case "invalid_secret_ref":
      return {
        cause: `'${i.path}' has an invalid format.`,
        fix: "Use 'env:VAR_NAME' (from .env or the shell) or 'literal:value'. Example: env:ANTHROPIC_API_KEY",
      };
    case "invalid_mode":
      return {
        cause: `'${i.path}' value '${d}' is not a supported mode.`,
        fix: "Use one of: smart, full, summary.",
      };
    case "invalid_kind":
      return {
        cause: `'${i.path}' value '${d}' is not supported.`,
        fix: "provider.kind must be claude|openai and messenger.kind must be telegram.",
      };
    case "invalid_number":
      return {
        cause: `'${i.path}' value '${d}' is not a positive integer.`,
        fix: "Use an integer >= 1 (e.g. 3000).",
      };
    case "threshold_over_max":
      return {
        cause: "inlineThresholdChars is larger than maxChars.",
        fix: "Lower inlineThresholdChars to at most maxChars, or raise maxChars.",
      };
    case "invalid_value":
      return {
        cause: `'${i.path}' is invalid (${d}).`,
        fix: `Run ${INIT_CMD} again or edit config.json.`,
      };
  }
}

export function explainConfigIssue(issue: ConfigIssue, lang: MessageLang): Explanation {
  return lang === "ko" ? issueKo(issue) : issueEn(issue);
}

export function explainConfigError(error: ConfigError, lang: MessageLang): Explanation[] {
  const ko = lang === "ko";
  switch (error.kind) {
    case "not_found":
      return [
        ko
          ? {
              cause: `설정 파일이 없습니다: ${error.path}`,
              fix: `${INIT_CMD} 를 실행해 온보딩을 진행하세요.`,
            }
          : { cause: `Config file not found: ${error.path}`, fix: `Run ${INIT_CMD} to onboard.` },
      ];
    case "unreadable": {
      const detail = error.detail;
      if (detail === "symlink" || detail === "not_regular_file") {
        return [
          ko
            ? {
                cause: `설정 경로가 일반 파일이 아닙니다(심볼릭 링크 등): ${error.path}`,
                fix: "링크를 지우고 실제 파일을 두세요. 필요하면 init을 다시 실행하세요.",
              }
            : {
                cause: `Config path is not a regular file (symlink?): ${error.path}`,
                fix: "Remove the link and keep a real file there, or re-run init.",
              },
        ];
      }
      if (detail === "insecure_permissions") {
        return [
          ko
            ? {
                cause: `설정 파일 권한이 느슨합니다(다른 계정이 읽을 수 있음): ${error.path}`,
                fix: `chmod 600 ${error.path} 를 실행한 뒤 다시 시도하세요.`,
              }
            : {
                cause: `Config file permissions are too permissive, readable by other accounts: ${error.path}`,
                fix: `Run chmod 600 ${error.path} and try again.`,
              },
        ];
      }
      return [
        ko
          ? {
              cause: `설정 파일을 읽거나 쓸 수 없습니다: ${error.path} (${detail})`,
              fix: "파일·디렉터리 권한(600/700)과 소유자를 확인하세요.",
            }
          : {
              cause: `Cannot read or write config file: ${error.path} (${detail})`,
              fix: "Check the file and directory permissions (600/700) and owner.",
            },
      ];
    }
    case "invalid_json":
      return [
        ko
          ? {
              cause: `설정 파일이 올바른 JSON이 아닙니다: ${error.path}`,
              fix: `파일을 고치거나 ${INIT_CMD} 로 다시 생성하세요. (오류 원문은 비밀값 보호를 위해 표시하지 않습니다)`,
            }
          : {
              cause: `Config file is not valid JSON: ${error.path}`,
              fix: `Fix the file or regenerate it with ${INIT_CMD}. (Parser text is withheld to protect secrets.)`,
            },
      ];
    case "invalid":
      return error.issues.map((i) => explainConfigIssue(i, lang));
  }
}

export function explainSecretError(error: SecretError, lang: MessageLang): Explanation {
  const ko = lang === "ko";
  switch (error.kind) {
    case "malformed_ref":
      return ko
        ? {
            cause: `'${error.field}' 참조 형식이 잘못되었습니다.`,
            fix: "'env:VAR_NAME' 또는 'literal:값' 형태로 고치세요.",
          }
        : {
            cause: `'${error.field}' reference is malformed.`,
            fix: "Use 'env:VAR_NAME' or 'literal:value'.",
          };
    case "env_missing":
      return ko
        ? {
            cause: `'${error.field}'이(가) 가리키는 환경변수 ${error.varName}이(가) 설정되어 있지 않습니다.`,
            fix: `.env 파일에 ${error.varName}=... 를 추가하거나 ${INIT_CMD} 를 다시 실행하세요.`,
          }
        : {
            cause: `Environment variable ${error.varName} referenced by '${error.field}' is not set.`,
            fix: `Add ${error.varName}=... to your .env file or re-run ${INIT_CMD}.`,
          };
    case "empty":
      return ko
        ? {
            cause: `'${error.field}' 값이 비어 있습니다.`,
            fix: `${INIT_CMD} 를 다시 실행해 키/토큰을 입력하세요.`,
          }
        : {
            cause: `'${error.field}' resolved to an empty value.`,
            fix: `Re-run ${INIT_CMD} and enter the key/token.`,
          };
  }
}

/** Renders explanations as lines: "원인: … / 수정: …". */
export function formatExplanations(items: readonly Explanation[], lang: MessageLang): string {
  const [c, f] = lang === "ko" ? ["원인", "수정 방법"] : ["Cause", "Fix"];
  return items.map((e) => `${c}: ${e.cause}\n${f}: ${e.fix}`).join("\n\n");
}
