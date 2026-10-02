# Word(.docx) 스타일 가이드

## 기술 스택

- **docx-js** (npm install -g docx): Word 문서 생성
- **docx 스킬** (`/mnt/skills/public/docx/SKILL.md`): 반드시 먼저 읽고 기술 규칙을 따른다
- 생성 후 `python scripts/office/validate.py`로 검증

## 디자인 원칙

샘플 리포트의 디자인 언어를 따른다:
- 전문적이고 절제된 컨설팅 스타일
- 파란색 계열 헤더 + 흰색 기반 본문
- 가독성 최우선: 충분한 여백, 적절한 줄 간격
- 테이블은 헤더 행에 파란 배경, 교대 행 음영

## 페이지 설정

```javascript
// A4 용지 (기본값), 여백 설정
sections: [{
  properties: {
    page: {
      size: {
        width: 11906,   // A4 width in DXA
        height: 16838   // A4 height in DXA
      },
      margin: {
        top: 1440,      // 1 inch
        right: 1296,    // 0.9 inch
        bottom: 1440,   // 1 inch
        left: 1296      // 0.9 inch
      }
    }
  },
  children: [/* content */]
}]
// A4 content width = 11906 - 1296 - 1296 = 9314 DXA
```

## 색상 시스템

```javascript
const COLORS = {
  primary: "4A90D9",       // 메인 파란색 (헤더 배경)
  primaryDark: "2C5F8A",   // 진한 파란색 (강조)
  primaryLight: "E8F0FE",  // 연한 파란색 (교대 행 배경)
  accent: "FF6B35",        // 강조 (주황)
  positive: "27AE60",      // 긍정/강점 (초록)
  negative: "E74C3C",      // 부정/약점 (빨강)
  text: "333333",          // 본문
  textLight: "666666",     // 보조 텍스트
  bgLight: "F8F9FA",       // 연한 배경
  white: "FFFFFF",
  border: "DEE2E6",        // 테이블 border
};
```

## 폰트 & 스타일 설정

```javascript
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Arial", size: 20, color: COLORS.text }  // 10pt 기본
      }
    },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1",
        basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: COLORS.primaryDark },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 }
      },
      {
        id: "Heading2", name: "Heading 2",
        basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: COLORS.primaryDark },
        paragraph: { spacing: { before: 240, after: 180 }, outlineLevel: 1 }
      },
      {
        id: "Heading3", name: "Heading 3",
        basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: COLORS.text },
        paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 2 }
      },
    ]
  },
  sections: [/* ... */]
});
```

### 폰트 크기 가이드 (docx-js half-point 단위)

| 요소 | font size 값 | 실제 크기 |
|------|-------------|----------|
| 커버 제목 | 72 | 36pt |
| 커버 부제목 | 36 | 18pt |
| 섹션 제목 (H1) | 36 | 18pt |
| 서브섹션 (H2) | 28 | 14pt |
| 소제목 (H3) | 24 | 12pt |
| 본문 | 20 | 10pt |
| 표 헤더 | 18 | 9pt |
| 표 내용 | 18 | 9pt |
| 푸터 | 16 | 8pt |

## 커버 페이지

커버는 별도 섹션으로 구성한다. 상단에 파란 배경 블록(테이블로 구현), 하단에 텍스트.

```javascript
// 커버 섹션 (별도 section, 페이지 번호 없음)
{
  properties: {
    page: { /* A4 설정 */ },
    titlePage: true  // 첫 페이지 별도 헤더/푸터
  },
  children: [
    // 제목 블록 (파란 배경 테이블로 구현)
    new Table({
      width: { size: 9314, type: WidthType.DXA },
      columnWidths: [9314],
      rows: [new TableRow({
        height: { value: 5000, rule: "exact" },
        children: [new TableCell({
          shading: { fill: COLORS.primary, type: ShadingType.CLEAR },
          verticalAlign: VerticalAlign.CENTER,
          borders: { /* 모두 NONE */ },
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { after: 200 },
              children: [new TextRun({
                text: "ChatGPT",
                font: "Arial", size: 72, bold: true, color: COLORS.white
              })]
            }),
            // "채널 브랜딩", "분석 리포트" 등 추가 행
          ]
        })]
      })]
    }),
    // 하단 텍스트
    new Paragraph({ spacing: { before: 600 }, children: [
      new TextRun({ text: "[타겟 브랜드] GEO 현황분석", size: 36, bold: true })
    ]}),
    new Paragraph({ children: [
      new TextRun({ text: "월간 분석 리포트", size: 28 })
    ]}),
    new Paragraph({ children: [
      new TextRun({ text: "(2026년 1월)", size: 24, color: COLORS.textLight })
    ]}),
  ]
}
```

## 목차

```javascript
// 커버 다음에 목차 페이지
new Paragraph({ children: [new PageBreak()] }),
new TableOfContents("목 차", {
  hyperlink: true,
  headingStyleRange: "1-3"
}),
new Paragraph({ children: [new PageBreak()] }),
```

## 테이블 스타일

모든 테이블은 아래 패턴을 따른다:

```javascript
const border = { style: BorderStyle.SINGLE, size: 1, color: COLORS.border };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// 헤더 행
function headerCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMargins,
    shading: { fill: COLORS.primary, type: ShadingType.CLEAR },
    children: [new Paragraph({
      children: [new TextRun({
        text, bold: true, size: 18, color: COLORS.white, font: "Arial"
      })]
    })]
  });
}

// 데이터 행 (교대 배경)
function dataCell(text, width, rowIndex) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMargins,
    shading: {
      fill: rowIndex % 2 === 0 ? COLORS.white : COLORS.bgLight,
      type: ShadingType.CLEAR
    },
    children: [new Paragraph({
      children: [new TextRun({ text, size: 18, font: "Arial" })]
    })]
  });
}
```

### 주요 테이블 레이아웃

| 테이블 | 컬럼 수 | 컬럼 비율 |
|--------|---------|----------|
| 월별 트렌드 (3.1) | 5 | 기간 15%, Vis 18%, SoV 18%, Rank 18%, 비고 31% |
| 브랜드 SoV (3.2) | 3 | 브랜드 20%, SoV 15%, 특징 65% |
| Category×Type (4.1) | 4 | Cat 18%, Type 18%, Trend 12%, Insight 52% |
| Persona 매트릭스 (5.1) | 4 | Persona 20%, 포지셔닝 20%, 강점 30%, 약점 30% |
| SWOT (7.1) | 3 | 구분 15%, 내용 50%, 변화 35% |
| 부록 쿼리 (9) | 4 | ID 12%, Query 48%, Category 20%, Type 20% |

## 헤더/푸터

```javascript
// 본문 섹션에 적용
headers: {
  default: new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({
        text: "ChatGPT 채널 브랜딩 분석 리포트 | 2026년 1월",
        size: 16, color: COLORS.textLight, font: "Arial"
      })]
    })]
  })
},
footers: {
  default: new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: "SUPERVISION", size: 16, color: COLORS.textLight }),
        new TextRun({ children: ["\t"] }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COLORS.textLight }),
      ]
    })]
  })
},
```

## 섹션 제목 블록

큰 섹션(1. Executive Summary 등)의 제목은 전체 너비 파란 배경 블록으로 표현한다.
docx-js에서는 테이블(1행 1열)로 구현:

```javascript
function sectionTitleBlock(number, title) {
  return new Table({
    width: { size: 9314, type: WidthType.DXA },
    columnWidths: [9314],
    rows: [new TableRow({
      height: { value: 1200, rule: "atLeast" },
      children: [new TableCell({
        shading: { fill: COLORS.primaryLight, type: ShadingType.CLEAR },
        verticalAlign: VerticalAlign.CENTER,
        borders: { /* NONE */ },
        margins: { top: 200, bottom: 200, left: 200, right: 200 },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: `${number}. ${title}`,
                size: 48, bold: true, font: "Arial", color: COLORS.primaryDark
              })
            ]
          })
        ]
      })]
    })]
  });
}
```

## 주의사항

1. **docx 스킬의 Critical Rules를 반드시 따른다**: `\n` 금지, unicode bullet 금지, 등
2. **모든 테이블은 DXA 단위**로 폭을 지정한다 (WidthType.PERCENTAGE 금지)
3. **columnWidths 합산 = 테이블 전체 폭** (9314 DXA for A4)
4. **ShadingType.CLEAR 사용** (SOLID 금지 - 검은 배경 방지)
5. **셀 내 긴 텍스트**는 Paragraph로 감싸서 자동 줄바꿈 처리
6. **한국어 폰트**: Arial은 한국어를 지원하나, 필요 시 "맑은 고딕"으로 대체 가능
7. **생성 후 반드시 validate.py로 검증**
