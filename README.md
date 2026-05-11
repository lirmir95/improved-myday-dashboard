# ✦ MY FINANCE · MY DAY · MY PROJECT

재정 · 일상 · 프로젝트를 하나의 대시보드에서 관리하는 **PWA 웹앱**입니다.  
GitHub Pages에 올려두고 아이패드/아이폰 홈화면에 앱처럼 추가해 사용할 수 있어요.

---

## 파일 구성

```
index.html            ← 메인 앱 (이거 하나에 모든 기능 포함)
manifest.webmanifest  ← PWA 설정 (홈화면 아이콘, 앱 이름 등)
sw.js                 ← Service Worker (오프라인 캐싱)
README.md             ← 이 파일
```

---

## GitHub Pages 배포 방법

### 1단계 — 저장소 만들기

1. [github.com](https://github.com) 로그인
2. 우상단 `+` → **New repository**
3. Repository name: 원하는 이름 (예: `my-finance`)
4. **Public** 선택 → **Create repository**

### 2단계 — 파일 올리기

저장소 페이지에서 **Add file → Upload files** 클릭 후  
이 4개 파일을 드래그&드롭 → **Commit changes**

### 3단계 — GitHub Pages 활성화

저장소 **Settings → Pages → Source**를  
`Deploy from a branch` → `main` 브랜치 → `/ (root)` 선택 → **Save**

### 4단계 — 접속 & 홈화면 추가

몇 분 후 아래 주소로 접속:
```
https://[내 GitHub 아이디].github.io/[저장소 이름]/
```

아이패드 Safari에서:
1. 위 주소 접속
2. 공유 버튼(□↑) 탭
3. **홈 화면에 추가** 선택
4. 추가 → 이제 앱처럼 실행!

---

## 기능

- **MY FINANCE** — 월별 예산, 고정지출, 저축 계획, 변동지출 캘린더
- **MY DAY** — 일일 루틴, 식단, 무드트래커, 운동, 수면, 메모
- **MY PROJECT** — 프로젝트 관리, 마일스톤, 일정, 회고
- **오프라인 지원** — 한 번 접속 후 인터넷 없이도 사용 가능
- **테마 커스터마이즈** — 색상, 폰트, 배경 이미지 변경
- **데이터 백업** — JSON 내보내기/가져오기

---

> 모든 데이터는 기기 로컬(`localStorage`)에 저장됩니다.  
> 저장소에 개인 정보가 올라가지 않아요.
