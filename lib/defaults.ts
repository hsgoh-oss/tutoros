// 1호 테넌트(AXIOM MATH LAB) 기본 콘텐츠 — DB(site_settings 등) 값이 우선하고 빈 항목만 이 값으로 폴백.
// 시드(supabase/seed.sql)와 동일 원천 — 수정 시 양쪽 정합 유지.

import type { SiteContent, Tenant } from "@/lib/types";

export const DEFAULT_TENANT: Tenant = {
  id: "00000000-0000-0000-0000-000000000001",
  brandName: "AXIOM MATH LAB",
  email: "hsgoh05@gmail.com",
  plan: "pro",
  planStatus: "active",
  customDomain: "axiommathlab.kr",
  subdomain: "axiom",
  domainVerified: false,
  tutorReportNo: null,
};

export const DEFAULT_CONTENT: SiteContent = {
  settings: {
    brandName: "AXIOM MATH LAB",
    tagline: "증명하는 수학, 액시엄매스랩",
    bizName: "액시엄매스랩",
    ceoName: "고현서",
    bizNo: "489-57-00885",
    email: "hsgoh05@gmail.com",
    address: "경기도 수원시 영통구 영통로 460",
    phone: null,
    kakaoUrl: "https://pf.kakao.com/_xdbSxhX/chat",
    instagramUrl: "https://www.instagram.com/axiom_math_lab",
    kimProfileUrl:
      "https://kimstudy.com/tutor/s/e0d107b4-c91a-4aca-9381-717157e99ecb?O3WRXJQK9E=D1072AQ1A",
    kimReviewUrl:
      "https://kimstudy.com/tutor/s/e0d107b4-c91a-4aca-9381-717157e99ecb?O3WRXJQK9E=D1072AQ1A",
    tutorReportNo: null,
    gaId: "G-TEKQVSK73W",
    bankAccount: null,
    seoDescription:
      "김과외 전국 상위 0.2% 튜터의 1:1 수학 과외. 내신·수능·수리논술 맞춤 수업, 매 수업 학부모 리포트 발송. 대면·화상 수업 상담 환영.",
  },

  rates: { inperson: 80000, video: 60000, trial: 50000 },

  badges: [
    "김과외 전국 상위 0.2% 튜터",
    "수능 수학 1등급",
    "한양대 수리논술 최초합격",
  ],

  ddays: [
    {
      id: "dday-1",
      name: "2027학년도 9월 모의평가",
      examDate: "2026-09-02",
      isVisible: true,
      sortOrder: 1,
    },
    {
      id: "dday-2",
      name: "2027학년도 대학수학능력시험",
      examDate: "2026-11-19",
      isVisible: true,
      sortOrder: 2,
    },
  ],

  recruit: {
    status: "open",
    message: "7월 신규 수강생 2명 모집 중",
    seatCount: 2,
    isBannerVisible: true,
  },

  reviews: [
    {
      id: "rev-1",
      reviewerType: "parent",
      content:
        "아이가 많이 따르고 수업도 스타일이 잘 맞다고 합니다~ 무엇보다 수업시간을 정확히 맞춰 주셔서 좋아요. 앞으로도 잘 부탁드립니다^^",
      rating: 5,
      beforeGrade: null,
      afterGrade: null,
      region: "부산",
      grade: "고3",
      track: "이과",
      source: "김과외",
      reviewedAt: "2025-04-24",
      screenshots: ["/img/reviews/rev-1.jpg"],
      aiTags: [],
      isPinned: true,
    },
    {
      id: "rev-2",
      reviewerType: "student",
      content:
        "저의 개인 사정으로 짧은 시간 수업을 받았지만, 꼼꼼한 풀이와 기억해야 하는 부분을 친절히 잘 가르쳐주셔서 너무 좋았습니다.",
      rating: 5,
      beforeGrade: null,
      afterGrade: null,
      region: "경북",
      grade: "고3",
      track: "이과",
      source: "김과외",
      reviewedAt: "2025-07-10",
      screenshots: ["/img/reviews/rev-2.jpg"],
      aiTags: [],
      isPinned: false,
    },
    {
      id: "rev-3",
      reviewerType: "student",
      content:
        "수1, 수2 개념 수업을 들었는데 개념을 정말 꼼꼼하고 이해하기 쉽게 설명해주셔서 큰 도움이 됐어요. 기초부터 잘 잡고 싶은 분들께 추천합니다.",
      rating: 5,
      beforeGrade: null,
      afterGrade: null,
      region: "세종",
      grade: "고1",
      track: "이과",
      source: "김과외",
      reviewedAt: "2025-07-30",
      screenshots: ["/img/reviews/rev-5.jpg"],
      aiTags: [],
      isPinned: false,
    },
    {
      id: "rev-4",
      reviewerType: "parent",
      content:
        "시작한 지는 얼마 안 됐지만 편안한 분위기에서 아이의 눈높이에 맞게 차분하게 설명을 잘 해주시고, 수업 진행 내용·과제 등 아이가 질문도 많은 편인데 실시간으로 소통도 잘 해주셔서 감사합니다~ 아이도 수학에 좀 더 집중해서 공부하려고 노력하는 것 같습니다.",
      rating: 5,
      beforeGrade: null,
      afterGrade: null,
      region: "경기",
      grade: "고3",
      track: "이과",
      source: "김과외",
      reviewedAt: "2026-05-21",
      screenshots: ["/img/reviews/rev-4.jpg"],
      aiTags: [],
      isPinned: true,
    },
    {
      id: "rev-5",
      reviewerType: "student",
      content: "꼼꼼하게 잘 가르쳐 주시고 쉽게 알려주세요.",
      rating: 5,
      beforeGrade: null,
      afterGrade: null,
      region: "경기",
      grade: "고2",
      track: "문과",
      source: "김과외",
      reviewedAt: "2026-06-01",
      screenshots: ["/img/reviews/rev-3.jpg"],
      aiTags: [],
      isPinned: false,
    },
  ],

  cases: [
    {
      name: "여OO 학생",
      beforeLabel: "고1 2학기 내신",
      beforeGrade: "2등급",
      afterLabel: "고2 1학기 내신",
      afterGrade: "1등급",
    },
    {
      name: "차OO 학생",
      beforeLabel: "고2 11월 모의고사",
      beforeGrade: "2등급",
      afterLabel: "고3 5월 모의고사",
      afterGrade: "1등급",
    },
    {
      name: "허O 학생",
      beforeLabel: "고3 3월 모의고사",
      beforeGrade: "5등급",
      afterLabel: "고3 7월 모의고사",
      afterGrade: "2등급",
    },
    {
      name: "김OO 학생",
      beforeLabel: "고3 6월 모의고사",
      beforeGrade: "4등급",
      afterLabel: "고3 9월 모의고사",
      afterGrade: "3등급",
    },
  ],

  // 기본 FAQ 초안 — 갑(발주처) 검수 대상. 관리자에서 편집 가능.
  faqs: [
    {
      id: "faq-1",
      category: "상담·시범",
      question: "상담은 어떻게 진행되나요?",
      answer:
        "상담 페이지의 신청 폼을 남겨 주시면 확인 후 연락드립니다. 학생의 현재 상태(학년·최근 성적·목표)를 여쭙고, 수업 방식과 일정·수업료를 안내드립니다. 상담은 무료이며, 상담 후 등록을 강요하지 않습니다.",
      sortOrder: 1,
    },
    {
      id: "faq-2",
      category: "상담·시범",
      question: "시범수업이 있나요?",
      answer:
        "네. 시범수업은 1시간 5만 원으로 별도 운영됩니다. 정규 등록 시 수업료에서 차감되지 않는 독립 수업이며, 시범수업 후 등록 여부를 자유롭게 결정하시면 됩니다.",
      sortOrder: 2,
    },
    {
      id: "faq-3",
      category: "수업",
      question: "수업은 대면과 화상 중 선택할 수 있나요?",
      answer:
        "네. 대면 수업과 화상 수업 모두 운영합니다. 대면은 경기 수원 인근 지역에서, 화상은 전국 어디서나 가능합니다. 두 방식 모두 동일한 커리큘럼과 리포트 시스템으로 진행됩니다.",
      sortOrder: 3,
    },
    {
      id: "faq-4",
      category: "수업",
      question: "수업 시간과 횟수는 어떻게 정하나요?",
      answer:
        "정규 수업은 회당 최소 2시간부터 0.5시간 단위로 조정 가능하며(회당 2~6시간), 주 1~7회 중 학생의 일정과 목표에 맞춰 정합니다. 상담 시 권장 구성을 함께 제안드립니다.",
      sortOrder: 4,
    },
    {
      id: "faq-5",
      category: "수업료",
      question: "수업료는 어떻게 계산되나요?",
      answer:
        "시간당 단가(대면 8만 원·화상 6만 원) × 회당 수업 시간 × 주당 횟수 × 4주 정액으로 계산됩니다. 예: 대면 회당 2.5시간 × 주 2회 = 시간당 8만 원 × 2.5시간 × 주 2회 × 4주 = 160만 원. 수업 안내 페이지의 계산기로 직접 확인하실 수 있습니다.",
      sortOrder: 5,
    },
    {
      id: "faq-6",
      category: "수업료",
      question: "결제는 어떻게 하나요?",
      answer:
        "4주 단위 선납이며, 결제 링크(카드·간편결제) 또는 계좌이체로 결제하실 수 있습니다. 결제 예정일 3일 전에 안내를 드립니다.",
      sortOrder: 6,
    },
    {
      id: "faq-7",
      category: "수업",
      question: "어떤 학생이 수업 대상인가요?",
      answer:
        "고1~고3 및 재수생을 대상으로 내신·수능·수리논술(약술형 포함) 수학을 지도합니다. 기초가 부족한 학생부터 최상위권 심화까지, 첫 상담에서 현재 상태를 진단하고 맞춤 커리큘럼을 설계합니다.",
      sortOrder: 7,
    },
    {
      id: "faq-8",
      category: "운영",
      question: "수업 일정 변경이나 보강은 어떻게 하나요?",
      answer:
        "부득이한 사정으로 수업이 어려운 경우 사전에 연락 주시면 상호 협의하여 보강 일정을 잡습니다. 보강 일정이 확정되면 안내 메시지를 보내드립니다.",
      sortOrder: 8,
    },
    {
      id: "faq-9",
      category: "운영",
      question: "수업 진행 상황은 어떻게 확인하나요?",
      answer:
        "매 수업 후 수업 내용·과제·집중도를 담은 수업 리포트를 학부모님께 보내드립니다. 주간·월간 리포트와 시험 분석 리포트도 제공되어, 묻지 않아도 아이의 진행 상황을 정확히 아실 수 있습니다.",
      sortOrder: 9,
    },
    {
      id: "faq-10",
      category: "운영",
      question: "환불 규정은 어떻게 되나요?",
      answer:
        "학원법 교습비 반환 기준을 준용합니다. 수업 시작 전에는 전액 환불되며, 시작 후에는 경과 시간에 따라 산정됩니다. 시범수업비는 진행 후 환불이 불가하고, 24시간 전 취소 시 전액 환불됩니다. 자세한 내용은 환불 규정 페이지를 확인해 주세요.",
      sortOrder: 10,
    },
  ],

  subjects: [
    {
      key: "naesin",
      title: "내신 수학",
      target: "고1~고3 · 학교별 맞춤",
      summary: "학교별 기출 경향을 분석해 시험에 나오는 것부터 잡습니다.",
      points: [
        "학교별 기출·부교재 분석 후 커리큘럼 설계",
        "서술형 감점 제로를 위한 답안 작성 훈련",
        "시험 3주 전 실전 모드 전환(기출 변형 반복)",
      ],
    },
    {
      key: "suneung",
      title: "수능 수학",
      target: "고2~재수 · 등급대별 전략",
      summary: "평가원 기출 중심으로 등급대별 다른 전략을 적용합니다.",
      points: [
        "개념 구멍 진단 후 취약 단원 역순 보강",
        "준킬러(4점) 정답률을 끌어올리는 접근법 훈련",
        "주간 모의 테스트로 시간 관리·실전 감각 유지",
      ],
    },
    {
      key: "nonsul",
      title: "수리논술·약술형",
      target: "수시 준비 고2~고3",
      summary: "한양대 수리논술 최초합격의 경험으로 답안의 논리를 세웁니다.",
      points: [
        "대학별 기출 유형 분석·첨삭 중심 수업",
        "증명·서술의 논리 전개 집중 훈련",
        "수능 최저 대비와 병행 가능한 일정 설계",
      ],
    },
  ],

  // 메인 자기진단 체크리스트 — 선택 항목은 상담 폼과 함께 저장된다.
  checklist: [
    { id: "chk-1", text: "개념은 아는 것 같은데 문제만 보면 손이 멈춘다" },
    { id: "chk-2", text: "학원을 오래 다녔는데 등급이 그대로다" },
    { id: "chk-3", text: "숙제는 다 하는데 시험 점수로 이어지지 않는다" },
    { id: "chk-4", text: "틀린 문제를 다시 풀면 또 틀린다" },
    { id: "chk-5", text: "모의고사 4점 문항 앞에서 항상 막힌다" },
    { id: "chk-6", text: "공부 시간은 많은데 뭘 모르는지 모르겠다" },
    { id: "chk-7", text: "수학 때문에 다른 과목 공부 시간까지 흔들린다" },
  ],
};

/* ---------- 1~9등급 성장 경로 (수업 안내 페이지) ---------- */
// 관리자 편집 대상이 아닌 정적 콘텐츠 — 이 배열만 고치면 로드맵이 바뀐다.

export interface GradePathStage {
  range: string; // 예: "9~7등급"
  title: string; // 예: "기초 정립"
  desc: string;
}

export const DEFAULT_GRADE_PATH: GradePathStage[] = [
  {
    range: "9~7등급",
    title: "기초 정립",
    desc: "개념의 뿌리부터 다시 세웁니다. 왜 그렇게 되는지 스스로 설명할 수 있을 때까지 기본기를 채웁니다.",
  },
  {
    range: "6~4등급",
    title: "개념 완성",
    desc: "단원별 개념을 빈틈없이 연결하고, 유형별 접근법을 손에 익혀 안정적으로 문제를 풉니다.",
  },
  {
    range: "3~2등급",
    title: "실전 훈련",
    desc: "기출·모의고사로 시간 관리와 실수 요인을 잡고, 준킬러(4점) 정답률을 끌어올립니다.",
  },
  {
    range: "1등급",
    title: "최상위권 심화",
    desc: "킬러 문항과 서술형까지, 어떤 문제에도 흔들리지 않는 안정성을 완성합니다.",
  },
];
