use super::schema;
use shopify_function::prelude::*;
use shopify_function::scalars::Decimal;
use shopify_function::Result;

/// Gauge -> value (price rate: value × girth × 10)
const GAUGE_VALUES: [(i64, f64); 5] = [
    (16, 0.30),
    (18, 0.23),
    (20, 0.21),
    (24, 0.25),
    (26, 0.21),
];

fn get_value_for_gauge(gauge: i64) -> f64 {
    GAUGE_VALUES
        .iter()
        .find(|(g, _)| *g == gauge)
        .map(|(_, v)| *v)
        .unwrap_or(0.30)
}

fn parse_f64(s: Option<&str>) -> f64 {
    s.and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0)
}

fn parse_i64(s: Option<&str>) -> i64 {
    s.and_then(|v| v.parse::<i64>().ok()).unwrap_or(16)
}

#[shopify_function]
fn cart_transform_run(
    input: schema::cart_transform_run::CartTransformRunInput,
) -> Result<schema::CartTransformRunResult> {
    let mut operations = vec![];

    for line in input.cart().lines() {
        let shape_type = line
            .shape_type()
            .as_ref()
            .and_then(|a| a.value().map(|s| s.as_str()))
            .map(|s| s.trim());
        if shape_type != Some("L") {
            continue;
        }

        let l1 = parse_f64(line.l_1().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
        let l2 = parse_f64(line.l_2().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
        let gauge = parse_i64(line.gauge().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
        let _qty = line.quantity();

        if l1 <= 0.0 || l2 <= 0.0 {
            continue;
        }

        let value = get_value_for_gauge(gauge);
        let girth = l1 + l2;
        let length_feet = 10.0;
        let unit_price = value * girth * length_feet;
        let amount = (unit_price * 100.0).round() / 100.0;

        let line_update = schema::LineUpdateOperation {
            cart_line_id: line.id().clone(),
            image: None,
            price: Some(schema::LineUpdateOperationPriceAdjustment {
                adjustment: schema::LineUpdateOperationPriceAdjustmentValue::FixedPricePerUnit(
                    schema::LineUpdateOperationFixedPricePerUnitAdjustment {
                        amount: Decimal(amount),
                    },
                ),
            }),
            title: None,
        };

        operations.push(schema::Operation::LineUpdate(line_update));
    }

    Ok(schema::CartTransformRunResult { operations })
}
