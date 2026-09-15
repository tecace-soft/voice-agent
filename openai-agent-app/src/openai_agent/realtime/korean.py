"""Korean pronunciation guidance, added to a GPT-Live call once the caller is heard speaking Korean.

Every prompt in this app is written in English, and OpenAI's advice for GPT-Live is to write the
prompt in the language the model should speak. Measured on the real API: with the English prompt
alone, the agent answered Korean callers in Korean but left English inside its sentences ("AI",
"Claude" — spoken with English phonetics) and read times as digits ("오전 9시"). The same prompt plus
a short block written IN KOREAN left no English words at all and read times the native way
("오전 아홉 시").

The block cannot sit in the startup prompt, though. Written in Korean, it also made the agent GREET
in Korean before anyone had spoken — wrong for the English callers who are most of them. So the
bridge appends it only after hearing Korean from the caller.
"""

from __future__ import annotations

import re

HANGUL = re.compile(r"[가-힣]")

# English words the prompts put in the agent's mouth, and how a Korean speaker says them. Only
# entries whose word appears in THIS call's prompt are sent, so one business's names never reach
# another business's caller — the same rule the FAQ follows.
_LOANWORDS = {
    "TecAce": "테크에이스",
    "tecace.com": "테크에이스 닷컴",
    "Tess": "테스",
    "Bellevue": "벨뷰",
    "Washington": "워싱턴",
    "Seoul": "서울",
    "Claude": "클로드",
    "Anthropic": "앤트로픽",
    "Samsung": "삼성",
    "UnitedHealthcare": "유나이티드헬스케어",
    "Nike": "나이키",
    "Pacific": "태평양 시간",
    "AI": "에이아이",
}

_GUIDE = """\
# 한국어로 말하기 (발신자가 한국어로 말하고 있습니다)
- 서울 표준어를 쓰는 한국인 원어민처럼 자연스러운 발음과 억양으로 말하세요. 영어식 억양이나 영어 발음을 섞지 마세요.
- 영어 이름과 단어는 모두 한국어 외래어 발음으로 말하세요.{loanwords}
- 시각은 고유어로 말하세요: "오전 아홉 시", "오후 여섯 시", "두 시 반". "구 시"나 "나인 에이엠"처럼 말하지 마세요.
- 날짜는 "9월 15일 화요일"처럼, 전화번호는 숫자를 하나씩 "공, 일, 공"처럼 말하세요.
- 정중한 존댓말(해요체)을 쓰세요.
- 발신자가 다른 언어로 바꾸면 그 언어로 따라가세요.
"""


def korean_speech_guide(instructions: str) -> str:
    """The guidance block for one call, naming only the English words its own prompt contains."""
    found = [
        f"{en} → {ko}"
        for en, ko in _LOANWORDS.items()
        # Whole words only: "AI" must not match inside "EMAIL".
        if re.search(rf"(?<![A-Za-z]){re.escape(en)}(?![A-Za-z])", instructions)
    ]
    return _GUIDE.format(loanwords=f" 예: {', '.join(found)}." if found else "")
