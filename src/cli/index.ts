#!/usr/bin/env node
// CLI entry — assembly only. Real onboarding/daemon/status arrive in T7.
import { CORE_VERSION } from "../core/index.js";

const USAGE = `message ${CORE_VERSION}

사용법: npm run cli -- <init|start|status>

  init    온보딩 3문항 (모국어 / 프로바이더+키 / 메신저+토큰)   [T7에서 구현]
  start   long polling 데몬 시작                                    [T7에서 구현]
  status  설정 요약 + 봇 연결 상태                                   [T7에서 구현]`;

export function run(argv: readonly string[]): number {
  const command = argv[0];
  switch (command) {
    case "init":
    case "start":
    case "status":
      console.log(
        `'${command}' 명령은 아직 구현되지 않았습니다 (T7 예정). 현재는 스캐폴딩 단계입니다.`,
      );
      return 0;
    case undefined:
    case "-h":
    case "--help":
      console.log(USAGE);
      return 0;
    default:
      console.error(
        `알 수 없는 명령: '${command}'\n수정 방법: init, start, status 중 하나를 사용하세요.\n\n${USAGE}`,
      );
      return 1;
  }
}

process.exitCode = run(process.argv.slice(2));
