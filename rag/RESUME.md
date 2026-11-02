# 후속 개선 진행 — 2026-11-02

같은 codex/ku-background-knowledge 브랜치에서 작업 중. main/live/dataset 변경 없음.
최종 후보 E37 `414a6c0a830ffaf9c822574a66853ddcf46ea42c`를 동결하고 전체 비교 실행 중이다.
E26–E36 실패/진단 기록은 보존한다. BERTScore 설정·전문가 정답은 그대로다.

현재 실행: evaluation/ku_background_2026-10-31/e37-comparison.log
설정: comparison-e37.config.json. 출력: comparison-2026-11-02-e37/
원본 pre-security와 E25 측정/점수를 그대로 재사용하고, 새 E37 290개는 모두 새로 생성한다.
그 뒤 고정 BERTScore 개발43/검증62와 눈가림 Claude Opus5.5 평가를 실행한다.
단일 GPU 작업만 실행한다. 실행 중 소스 snapshot/설정/평가 runner를 수정하지 않는다.

E37의 변경: 입력 범주 판정, 일반 연습 라우팅/한국어 안내, Rosina 성격 검색 어휘,
원문을 확인하는 시작 반주 셈여림 비교. 영어는 출처별 문장에 인용을 따로 붙인다.
일반 비교 LLM/캐시는 제거했다. 출처 없는 음높이 개념 질문에는 짧은 질문·언어
입력과 제한된 추론을 쓰되, 입력·출력 검토는 전체 원래 문맥을 받는다.
교과서 정의를 통째로 넣던 E35/E36 실험은 제거했다. 답변표/정답 조회는 없다.

단위 테스트648개 통과. 23개 진단에서 원래 오거절3개와 한·영 p/PP 모두 응답,
공격 대조8개 차단. Claude: 정상15개 중 중대한 사실오류/출처의미변경0.
다만 조옮김의 옥타브 예외, 한국어 의도 단정 등 작은 표현 문제(3/4점)는 남는다.
probe-e37-judge의 불리한 평가도 보존한다. 아직 전체 평가와 최종 수용 전이다.

Lab 같은 브랜치에 production/test14파일 및 Source comparison 배지를 반영했다.
전체 평가 후 변경 답변·기존 의미41건 직접 대조, Lab 테스트, 보고서와 재현문서,
최종 보호 checkout/hash 확인, 양쪽 commit이 남았다. 재개 시 이 상태부터 진행한다.

이하 E25의 이전 완료 기록:

요청한 BERTScore 목표와 의미·품질 검토를 완료했다. 최종 구현은 E25,
측정 소스 `a93b108`이며 평가한 reviewed_catalog/1536 설정을 기본값으로 채택했다.
실행 중인 평가나 남은 구현 작업은 없다. 사용량/리셋 중지 조건과 notifier는 사용하지 않았다.

## 결과와 위치

- RAG: `/home/minhee/.codex/worktrees/rag-background-knowledge/soprano-qa-rag-system`
- Lab: `/home/minhee/.codex/worktrees/rag-background-knowledge/soprano-lab`, RAG는 `rag/`
- 양쪽 `codex/ku-background-knowledge` 브랜치. main/live/dataset은 기존 상태 그대로다.
- [최종 보고서](evaluation/ku_background_2026-10-31/report.md)
- [전체 답변 비교](evaluation/ku_background_2026-10-31/comparison-2026-11-02-e25/review/review.html)
- [현재 프롬프트](evaluation/ku_background_2026-10-31/prompts-e25/)
- [최종 검증](evaluation/ku_background_2026-10-31/final-verification.json)
- [재현 방법](evaluation/ku_background_2026-10-31/reproduce.md)

## 실제 확인한 결과

전문가 Korean validation62/62응답, 고정 BERTScore F1 **0.9734575239**.
전체290요청 실행오류0, 주입공격 성공0/58, 범위밖요청 성공0/12,
정상 오거절3/216, Claude 중대한 의미 변경0, 실질적 사실 오류0,
혼합/불확실 사실2, 종합루브릭94.8232/100.

알려진 의미41개와 D.S./마이크조건/박자설명을 대조했다.
E24→E25 정상220개 전체 packet은 동일하며, 인코딩 지시문을 그대로 인용하던
공격1개만 차단 응답으로 바뀌었다. LLM판정과 별도의 직접 검토 지적을 보존했다.
Root RAG637, Lab RAG637, Lab demo44 tests와 catalog/prompt 검증이 통과했다.
양쪽 source20모듈·corpus·LLM설정은 평가 snapshot과 일치한다.

## 해석과 이후 작업

BERTScore0.90은 충분한 기준이며 점수를 더 높이는 튜닝은 하지 않았다.
원문인용이 유사도를 높이므로0.97346은97%정확도가 아니다.
평가는 실패를 수정에 사용한 재사용 내부평가다. 전문가dev43/validation62는
원질문그룹이 겹치지 않지만 KU6개를 공유한다. 독립 일반화 성능을 주장하지 않는다.

남은 문제는 영어조옮김·영어호흡연습·한국어Rosina해석의 거절3개,
p/PP자료불일치 설명 부족, 작은 hedge/귀속 문제, 마이크원문 모호성, 긴반복인용이다.
최초 대비 공통209개 정상질문 중앙값은3.35→5.25초다.
영어catalog129는 기계작성/모델검토이며 전문가영어정답이 아니다.
기본박자는 계산+guard로 처리하며 API에계산임을기록한다.
간접공격은 검색후 강제노출이며0/58은모든미래공격의방어보증이아니다.

완료된 실행을 다시 시작할 필요는 없다. 추가 변경을 요청받으면 새 snapshot,
config, output을 만들고 기존 실패 후보·reference·판정을 유지한다.
[resume-state.json](evaluation/ku_background_2026-10-31/resume-state.json)에
완료 상태와 검증 파일 해시를 기록했다.
