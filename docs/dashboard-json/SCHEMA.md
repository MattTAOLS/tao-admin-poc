# dashboard.json deal object — field inventory

Derived from 12 real per-deal objects (9 MOVE Trust, period 2026-07; 3 F-PIL 2.0, period 2026-08). "In" = how many of the 12 deals carry the path. Types are what was observed; null means the field can be absent for a deal.

| Path | Types | In |
| --- | --- | --- |
| `aging_history[]` | array | 12/12 |
| `aging_history[].bucket_sum` | float | 12/12 |
| `aging_history[].bucket_sum_with_writeoff` | float | 12/12 |
| `aging_history[].closing_balance` | float | 12/12 |
| `aging_history[].collection_period` | str | 12/12 |
| `aging_history[].cumulative_net_losses` | float | 12/12 |
| `aging_history[].current_0_30` | float | 12/12 |
| `aging_history[].days_31_60` | float | 12/12 |
| `aging_history[].days_61_90` | float | 12/12 |
| `aging_history[].period` | str | 12/12 |
| `aging_history[].reconciles` | bool | 12/12 |
| `aging_history[].tranche_rows` | null | 8/12 |
| `aging_history[].tranche_rows[]` | array | 1/12 |
| `aging_history[].tranche_rows[].closing_tranche_contract_balance` | float | 1/12 |
| `aging_history[].tranche_rows[].cumulative_net_losses` | float | 1/12 |
| `aging_history[].tranche_rows[].current` | float | 1/12 |
| `aging_history[].tranche_rows[].days_31_60` | float | 1/12 |
| `aging_history[].tranche_rows[].days_61_90` | float | 1/12 |
| `aging_history[].tranche_rows[].deemed_defaults` | float | 1/12 |
| `aging_history[].tranche_rows[].funding_date` | str | 1/12 |
| `aging_history[].tranche_rows[].net_book_value` | float | 1/12 |
| `aging_history[].tranche_rows[].tranche` | int | 1/12 |
| `aging_history[].written_off` | float | 12/12 |
| `aging_history[].written_off_bucket_label` | str | 12/12 |
| `balance_discontinuities[]` | array | 12/12 |
| `balance_discontinuities[].current_opening` | float | 7/12 |
| `balance_discontinuities[].explained_by_new_tranches` | float, int, null | 7/12 |
| `balance_discontinuities[].field` | str | 7/12 |
| `balance_discontinuities[].fully_explained` | bool | 7/12 |
| `balance_discontinuities[].gap` | float | 7/12 |
| `balance_discontinuities[].new_tranche_count` | int | 7/12 |
| `balance_discontinuities[].new_tranche_ids[]` | array, int | 7/12 |
| `balance_discontinuities[].period` | str | 7/12 |
| `balance_discontinuities[].prior_closing` | float | 7/12 |
| `balance_discontinuities[].prior_period` | str | 7/12 |
| `balance_discontinuities[].residual` | float | 7/12 |
| `cnl_by_period[]` | array | 12/12 |
| `cnl_by_period[].actual_recoveries` | float | 3/12 |
| `cnl_by_period[].advance_range` | null, str | 8/12 |
| `cnl_by_period[].annual_period` | str | 2/12 |
| `cnl_by_period[].cnl_limit` | float, null | 12/12 |
| `cnl_by_period[].cnl_limit_is_exception` | bool | 11/12 |
| `cnl_by_period[].cnl_ratio_pct` | float | 12/12 |
| `cnl_by_period[].cnl_ratio_reported_pct` | float | 1/12 |
| `cnl_by_period[].cnl_within_limit` | bool, null | 12/12 |
| `cnl_by_period[].cumulative_net_losses` | float | 10/12 |
| `cnl_by_period[].current_period_losses` | float | 2/12 |
| `cnl_by_period[].estimated_recoveries` | float | 3/12 |
| `cnl_by_period[].event_of_default_trigger_pct` | float | 2/12 |
| `cnl_by_period[].gross_losses` | float | 3/12 |
| `cnl_by_period[].losses_allocated` | float | 1/12 |
| `cnl_by_period[].original_finance_contract_nbv` | float | 1/12 |
| `cnl_by_period[].original_finance_contract_npv` | float | 8/12 |
| `cnl_by_period[].period` | str | 9/12 |
| `cnl_by_period[].period_cumulative_net_losses` | float | 4/12 |
| `cnl_by_period[].period_original_balance` | float | 4/12 |
| `cnl_by_period[].semi_annual_period` | int | 1/12 |
| `cnl_by_period[].spread_pct` | float | 2/12 |
| `cnl_by_period[].tranche_balance_funded` | float | 2/12 |
| `cnl_by_period[].tranches` | str | 1/12 |
| `cnl_by_period[].tranches_originated` | str | 1/12 |
| `cnl_pool_totals.cumulative_net_losses` | float | 1/12 |
| `cnl_pool_totals.original_tranche_balance` | float | 1/12 |
| `cnl_pool_totals.source` | str | 1/12 |
| `collection_period` | str | 12/12 |
| `contracts.change_abs` | float, int | 12/12 |
| `contracts.change_pct` | float, null | 12/12 |
| `contracts.closing` | float, int | 12/12 |
| `contracts.opening` | float, int | 12/12 |
| `contracts.top_movers[]` | array | 12/12 |
| `contracts.top_movers[].change_contracts` | float | 10/12 |
| `contracts.top_movers[].closing_contracts` | float | 10/12 |
| `contracts.top_movers[].opening_contracts` | float | 10/12 |
| `contracts.top_movers[].tranche` | int | 10/12 |
| `covenant_summary.AVAILABLE` | int | 12/12 |
| `covenant_summary.BREACH` | int | 12/12 |
| `covenant_summary.OK` | int | 12/12 |
| `covenant_summary.WATCH` | int | 12/12 |
| `covenants[]` | array | 12/12 |
| `covenants[].category` | str | 12/12 |
| `covenants[].current_value` | float, null | 12/12 |
| `covenants[].description` | str | 12/12 |
| `covenants[].kind` | str | 12/12 |
| `covenants[].legal_ref` | str | 12/12 |
| `covenants[].note` | null, str | 12/12 |
| `covenants[].status` | str | 12/12 |
| `covenants[].threshold` | float, null | 12/12 |
| `covenants[].trend` | str | 12/12 |
| `covenants[].utilization_pct` | float, null | 12/12 |
| `covenants[].worst_vintage` | str | 2/12 |
| `data_corrections[]` | array | 6/12 |
| `data_corrections[].applied` | str | 6/12 |
| `data_corrections[].field` | str | 6/12 |
| `data_corrections[].new_value` | float | 6/12 |
| `data_corrections[].old_value` | float | 6/12 |
| `data_corrections[].period` | str | 6/12 |
| `data_corrections[].reason` | str | 6/12 |
| `data_corrections[].record` | str | 6/12 |
| `deal_name` | str | 12/12 |
| `deal_slug` | str | 12/12 |
| `financial_ratios[]` | array | 12/12 |
| `financial_ratios[].format` | str | 12/12 |
| `financial_ratios[].group` | str | 12/12 |
| `financial_ratios[].key` | str | 12/12 |
| `financial_ratios[].label` | str | 12/12 |
| `financial_ratios[].value` | float | 12/12 |
| `financial_ratios[].vintage` | str | 5/12 |
| `period_history[]` | array | 12/12 |
| `period_history[].activity_by_currency` | null | 11/12 |
| `period_history[].activity_by_currency.CAD.interest` | float | 1/12 |
| `period_history[].activity_by_currency.CAD.losses` | float | 1/12 |
| `period_history[].activity_by_currency.CAD.principal` | float | 1/12 |
| `period_history[].activity_by_currency.CAD.principal_prepayments` | float | 1/12 |
| `period_history[].activity_by_currency.CAD.recoveries` | float | 1/12 |
| `period_history[].activity_by_currency.USD.interest` | float | 1/12 |
| `period_history[].activity_by_currency.USD.losses` | float | 1/12 |
| `period_history[].activity_by_currency.USD.principal` | float | 1/12 |
| `period_history[].activity_by_currency.USD.principal_prepayments` | float | 1/12 |
| `period_history[].activity_by_currency.USD.recoveries` | float | 1/12 |
| `period_history[].activity_by_currency.USD_cad_equivalent.interest` | float | 1/12 |
| `period_history[].activity_by_currency.USD_cad_equivalent.losses` | float | 1/12 |
| `period_history[].activity_by_currency.USD_cad_equivalent.principal` | float | 1/12 |
| `period_history[].activity_by_currency.USD_cad_equivalent.principal_prepayments` | float | 1/12 |
| `period_history[].activity_by_currency.USD_cad_equivalent.recoveries` | float | 1/12 |
| `period_history[].activity_by_currency.spot_rate` | float | 1/12 |
| `period_history[].amount_by_currency` | null | 11/12 |
| `period_history[].amount_by_currency.cad_closing` | float | 1/12 |
| `period_history[].amount_by_currency.total_cad_equivalent` | float | 1/12 |
| `period_history[].amount_by_currency.usd_closing_cad_equivalent` | float | 1/12 |
| `period_history[].amount_by_currency.usd_closing_raw` | float | 1/12 |
| `period_history[].by_currency` | null | 11/12 |
| `period_history[].by_currency.cad_closing` | float | 1/12 |
| `period_history[].by_currency.cad_opening` | float | 1/12 |
| `period_history[].by_currency.usd_closing_cad_equivalent` | float | 1/12 |
| `period_history[].by_currency.usd_closing_raw` | float | 1/12 |
| `period_history[].by_currency.usd_opening_cad_equivalent` | float | 1/12 |
| `period_history[].charge_off` | float, null | 9/12 |
| `period_history[].closing_amount` | float | 12/12 |
| `period_history[].closing_balance` | float | 12/12 |
| `period_history[].closing_contracts` | float, int | 12/12 |
| `period_history[].collection_period` | str | 12/12 |
| `period_history[].interest` | float | 12/12 |
| `period_history[].losses` | float | 12/12 |
| `period_history[].opening_amount` | float | 12/12 |
| `period_history[].opening_balance` | float | 12/12 |
| `period_history[].opening_contracts` | float, int | 12/12 |
| `period_history[].period` | str | 12/12 |
| `period_history[].principal` | float | 12/12 |
| `period_history[].principal_prepayments` | float | 12/12 |
| `period_history[].recoveries` | float | 12/12 |
| `prior_closing_contracts` | float, int | 12/12 |
| `prior_closing_tranche_balance` | float | 12/12 |
| `prior_covenants[]` | array | 12/12 |
| `prior_covenants[].category` | str | 12/12 |
| `prior_covenants[].current_value` | float, null | 12/12 |
| `prior_covenants[].description` | str | 12/12 |
| `prior_covenants[].kind` | str | 12/12 |
| `prior_covenants[].legal_ref` | str | 12/12 |
| `prior_covenants[].note` | null, str | 12/12 |
| `prior_covenants[].status` | str | 12/12 |
| `prior_covenants[].threshold` | float, null | 12/12 |
| `prior_covenants[].trend` | str | 12/12 |
| `prior_covenants[].utilization_pct` | float, null | 12/12 |
| `prior_covenants[].worst_vintage` | str | 2/12 |
| `prior_period` | str | 12/12 |
| `program.maximum_program_limit` | float, null | 12/12 |
| `program.program_amount` | float | 12/12 |
| `program.program_limit` | float | 12/12 |
| `program.program_utilization_pct` | float | 12/12 |
| `program.unused_facility` | float, null | 12/12 |
| `ratio_history[]` | array | 12/12 |
| `ratio_history[].debt_equity_ratio` | float | 9/12 |
| `ratio_history[].delinquency_ratio_pct` | float | 7/12 |
| `ratio_history[].interest_coverage_ratio` | float | 9/12 |
| `ratio_history[].loss_ratio_pct` | float | 2/12 |
| `ratio_history[].month` | str | 11/12 |
| `ratio_history[].monthly_delinquency_ratio_pct` | float | 2/12 |
| `ratio_history[].rolling_12month_loss_ratio_pct` | float | 5/12 |
| `ratio_history[].rolling_3month_loss_ratio_pct` | float | 5/12 |
| `ratio_history[].total_equity` | float | 9/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.current_test_result` | float | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.event_of_default_trigger` | float | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.event_of_default_triggered` | str | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.history[]` | array | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.history[].base_amount` | float | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.history[].numerator_amount` | float | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.history[].period` | str | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.history[].ratio_pct` | float | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.lockup_event_triggered` | str | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.lockup_trigger` | float | 1/12 |
| `ratio_test_detail.portfolio_charge_off_ratio.test_result_history[]` | array, float | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.current_test_result` | float | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.event_of_default_trigger` | float | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.event_of_default_triggered` | str | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.history[]` | array | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.history[].base_amount` | float | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.history[].numerator_amount` | float | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.history[].period` | str | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.history[].ratio_pct` | float | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.lockup_event_triggered` | str | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.lockup_trigger` | float | 1/12 |
| `ratio_test_detail.portfolio_deemed_default_ratio.test_result_history[]` | array, float | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.current_test_result` | float | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.event_of_default_trigger` | float | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.event_of_default_triggered` | str | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.history[]` | array | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.history[].base_amount` | float | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.history[].numerator_amount` | float | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.history[].period` | str | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.history[].ratio_pct` | float | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.lockup_event_triggered` | str | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.lockup_trigger` | float | 1/12 |
| `ratio_test_detail.portfolio_delinquency_ratio.test_result_history[]` | array, float | 1/12 |
| `restatements[]` | array | 12/12 |
| `restatements[].as_reported[]` | array | 3/12 |
| `restatements[].as_reported[].source_period` | str | 3/12 |
| `restatements[].as_reported[].value` | float | 3/12 |
| `restatements[].field` | str | 3/12 |
| `restatements[].month` | str | 3/12 |
| `settlement_date` | str | 12/12 |
| `source_file` | str | 12/12 |
| `source_pages.aggregate_performance` | int, null | 12/12 |
| `source_pages.aging_summary` | int | 12/12 |
| `source_pages.cumulative_losses` | int | 12/12 |
| `source_pages.enhancement` | int | 12/12 |
| `source_pages.financial_ratios` | int | 12/12 |
| `source_pages.funding_costs` | int, null | 12/12 |
| `source_pages.outstanding_contracts` | int, null | 12/12 |
| `source_pages.quantitative_tests` | int, null | 12/12 |
| `source_pages.top10_obligor` | int, null | 12/12 |
| `source_pages.tranche_amounts` | int | 12/12 |
| `source_pages.tranche_balance` | int | 12/12 |
| `terminology` | null | 9/12 |
| `terminology.amount_label` | str | 3/12 |
| `terminology.balance_label` | str | 3/12 |
| `terminology.unit_label` | str | 3/12 |
| `top10_obligors[]` | array | 12/12 |
| `top10_obligors[].aggregate_cad_contract_amount` | float | 1/12 |
| `top10_obligors[].aggregate_contract_amount` | float | 8/12 |
| `top10_obligors[].aggregate_usd_contract_amount` | float | 1/12 |
| `top10_obligors[].concentration_limit_desc` | str | 2/12 |
| `top10_obligors[].concentration_limit_pct` | float | 6/12 |
| `top10_obligors[].concentration_limit_per_obligor` | float | 8/12 |
| `top10_obligors[].excess_concentration_amount` | float | 8/12 |
| `top10_obligors[].obligor_concentration_pct` | float | 8/12 |
| `top10_obligors[].obligor_name` | str | 8/12 |
| `top10_obligors[].rank` | int | 8/12 |
| `total_enhancement.ending_cash_reserve_amount` | float | 1/12 |
| `total_enhancement.total_enhancement_amount` | float | 12/12 |
| `total_enhancement.total_enhancement_pct` | float | 12/12 |
| `tranche_amount.by_currency` | null | 11/12 |
| `tranche_amount.by_currency.cad_closing` | float | 1/12 |
| `tranche_amount.by_currency.total_cad_equivalent` | float | 1/12 |
| `tranche_amount.by_currency.usd_closing_cad_equivalent` | float | 1/12 |
| `tranche_amount.by_currency.usd_closing_raw` | float | 1/12 |
| `tranche_amount.closing` | float | 12/12 |
| `tranche_amount.opening` | float | 12/12 |
| `tranche_balance.activity_by_currency` | null | 11/12 |
| `tranche_balance.activity_by_currency.CAD.interest` | float | 1/12 |
| `tranche_balance.activity_by_currency.CAD.losses` | float | 1/12 |
| `tranche_balance.activity_by_currency.CAD.principal` | float | 1/12 |
| `tranche_balance.activity_by_currency.CAD.principal_prepayments` | float | 1/12 |
| `tranche_balance.activity_by_currency.CAD.recoveries` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD.interest` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD.losses` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD.principal` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD.principal_prepayments` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD.recoveries` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD_cad_equivalent.interest` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD_cad_equivalent.losses` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD_cad_equivalent.principal` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD_cad_equivalent.principal_prepayments` | float | 1/12 |
| `tranche_balance.activity_by_currency.USD_cad_equivalent.recoveries` | float | 1/12 |
| `tranche_balance.activity_by_currency.spot_rate` | float | 1/12 |
| `tranche_balance.all_tranches[]` | array | 12/12 |
| `tranche_balance.all_tranches[].closing` | float | 11/12 |
| `tranche_balance.all_tranches[].opening` | float | 11/12 |
| `tranche_balance.all_tranches[].tranche` | int | 11/12 |
| `tranche_balance.by_currency` | null | 11/12 |
| `tranche_balance.by_currency.cad_closing` | float | 1/12 |
| `tranche_balance.by_currency.cad_opening` | float | 1/12 |
| `tranche_balance.by_currency.usd_closing_cad_equivalent` | float | 1/12 |
| `tranche_balance.by_currency.usd_closing_raw` | float | 1/12 |
| `tranche_balance.by_currency.usd_opening_cad_equivalent` | float | 1/12 |
| `tranche_balance.change_abs` | float | 12/12 |
| `tranche_balance.change_pct` | float | 12/12 |
| `tranche_balance.charge_off` | float, null | 6/12 |
| `tranche_balance.closing` | float | 12/12 |
| `tranche_balance.interest` | float | 12/12 |
| `tranche_balance.losses` | float | 12/12 |
| `tranche_balance.opening` | float | 12/12 |
| `tranche_balance.principal` | float | 12/12 |
| `tranche_balance.principal_prepayments` | float | 12/12 |
| `tranche_balance.recoveries` | float | 12/12 |
| `tranche_balance.top_movers[]` | array | 12/12 |
| `tranche_balance.top_movers[].closing_tranche_balance` | float | 11/12 |
| `tranche_balance.top_movers[].currency` | str | 1/12 |
| `tranche_balance.top_movers[].current_period_effective_tranche_yield` | float, null | 11/12 |
| `tranche_balance.top_movers[].funding_date` | str | 1/12 |
| `tranche_balance.top_movers[].leasing_date` | str | 10/12 |
| `tranche_balance.top_movers[].opening_tranche_balance` | float | 11/12 |
| `tranche_balance.top_movers[].opening_tranche_balance_cad_equivalent` | float | 1/12 |
| `tranche_balance.top_movers[].original_tranche_balance` | float | 11/12 |
| `tranche_balance.top_movers[].original_tranche_yield` | float, null | 10/12 |
| `tranche_balance.top_movers[].rate_type` | str | 1/12 |
| `tranche_balance.top_movers[].tranche` | int | 11/12 |
| `warehouse` | null | 7/12 |
| `warehouse.closing_advances_outstanding` | float, null | 5/12 |
| `warehouse.maximum_warehouse_facility_limit` | float, null | 5/12 |
| `warehouse.opening_advances_outstanding` | float, null | 5/12 |
| `watch_buffer_pct` | float | 12/12 |
| `worst_status` | str | 12/12 |

## Program-level object (program-*.dashboard.json)

Top level: `period`, `deal_count`, `portfolio_totals`, `covenant_totals` {BREACH, WATCH, OK, AVAILABLE}, `deals_with_escalations`, `terminology`, `deals[]` (the per-deal objects above), `history_policy`. Program utilization is weighted by facility size (total drawn ÷ total limit), as the dashboards note.

## Covenant entry (deals[].covenants[])

`category`, `legal_ref`, `description`, `current_value`, `threshold`, `kind` (ceiling | floor), `utilization_pct` (value ÷ threshold), `trend`, `status` (OK | WATCH | BREACH | AVAILABLE), `note`, optional `worst_vintage`. SLFA 9.1(c)/(d) thresholds are conditional on portfolio NPV (6%/4% and 4%/2.25% below/above $10M): add a `threshold_rule` when extending.