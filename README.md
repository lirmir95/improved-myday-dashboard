# STILL DAY

하루, 건강, 운동, 프로젝트를 하나의 편집형 인터페이스에서 기록하고 Notion에 자동 백업하는 정적 PWA입니다.

## 주요 화면

- Dashboard — 하루·건강·운동·프로젝트 요약 및 일일 Convert
- My Day — 수분, 수면, 에너지, 기분, 식사, 할 일, 메모
- Training — 운동 기록, 세트/중량/반복/RPE, PR 자동 판정, 운동 라이브러리, 루틴
- Body & Goals — 체중·체지방 추이와 목표 진행률
- My Project — 월간 프로젝트, 다음 행동, 진행률, 월간 Convert
- Settings — 강조 색상, 대표 지표, Notion 연결

기존 `myday_v5`, `my_project_dashboard_v1` 로컬 저장 키를 그대로 사용해 과거 기록을 유지합니다.

## Notion 동기화

브라우저는 Cloudflare Worker만 호출하며 Notion 토큰은 서버 secret으로 보관합니다. 설정은 [`NOTION_SETUP.md`](./NOTION_SETUP.md)를 참고하세요.

## 로컬 실행

```powershell
node tools/serve.mjs
```

이후 `http://localhost:3000`에서 확인합니다.
