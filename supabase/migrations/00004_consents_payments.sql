-- 00004: 동의 항목 확장(보호자) + 결제 수단 토스 제거
-- (기획 7-17 동의 아키텍처 / 결제 무통장입금+결제선생 전환)

-- consents.item: 법정대리인(보호자) 동의를 기록할 슬롯 추가.
alter table public.consents drop constraint consents_item_check;
alter table public.consents add constraint consents_item_check
  check (item in ('privacy', 'overseas_ai', 'marketing', 'review', 'student_phone', 'guardian'));

-- payments.method: 토스 제거 → 무통장입금(bank) + 결제선생(payssaem)만.
-- (기존 toss 행이 있으면 bank로 이행 후 제약 교체)
update public.payments set method = 'bank' where method = 'toss';
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('payssaem', 'bank'));
