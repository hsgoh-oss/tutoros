-- 계좌이체 영수증은 결제용 bill_id와 별도 ID를 사용한다.
-- 외부 요청 전에 ID와 처리권을 저장해 중복 클릭과 결과 불명 시 재발급을 막는다.
alter table public.payments
  add column cash_receipt_bill_id text
    check (char_length(cash_receipt_bill_id) between 1 and 20),
  add column cash_receipt_operation text
    check (cash_receipt_operation in ('issue', 'cancel', 'sync')),
  add column cash_receipt_operation_id uuid,
  add column cash_receipt_operation_started_at timestamptz,
  add constraint payments_cash_receipt_operation_complete check (
    (cash_receipt_operation is null and cash_receipt_operation_id is null and cash_receipt_operation_started_at is null)
    or
    (cash_receipt_operation is not null and cash_receipt_operation_id is not null and cash_receipt_operation_started_at is not null)
  );

-- 기존 영수증은 기존 결제선생 청구서 ID로 계속 조회·취소한다.
update public.payments set cash_receipt_bill_id = bill_id
where cash_receipt_state is not null and bill_id is not null;

create unique index payments_cash_receipt_bill_id_key
  on public.payments(cash_receipt_bill_id)
  where cash_receipt_bill_id is not null;
