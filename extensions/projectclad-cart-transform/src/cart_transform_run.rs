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

/// Catalogue $/sq in for freeform custom profiles.
const GAUGE_RATES: [(i64, f64); 6] = [
    (16, 0.0153819),
    (18, 0.0112875),
    (20, 0.0094479),
    (22, 0.0077833),
    (24, 0.0104167),
    (26, 0.0082458),
];
const MATERIAL_MARKUP: f64 = 1.5;
const BEND_COST: f64 = 2.5;
const DEFAULT_LENGTH_IN: f64 = 120.0;

fn get_value_for_gauge(gauge: i64) -> f64 {
    GAUGE_VALUES
        .iter()
        .find(|(g, _)| *g == gauge)
        .map(|(_, v)| *v)
        .unwrap_or(0.30)
}

fn get_rate_for_gauge(gauge: i64) -> f64 {
    GAUGE_RATES
        .iter()
        .find(|(g, _)| *g == gauge)
        .map(|(_, v)| *v)
        .unwrap_or(0.0104167)
}

fn parse_f64(s: Option<&str>) -> f64 {
    s.and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0)
}

fn parse_i64(s: Option<&str>) -> i64 {
    s.and_then(|v| v.parse::<i64>().ok()).unwrap_or(16)
}

fn round_cents(amount: f64) -> f64 {
    (amount * 100.0).round() / 100.0
}

fn line_update(id: String, amount: f64) -> schema::Operation {
    schema::Operation::LineUpdate(schema::LineUpdateOperation {
        cart_line_id: id,
        image: None,
        price: Some(schema::LineUpdateOperationPriceAdjustment {
            adjustment: schema::LineUpdateOperationPriceAdjustmentValue::FixedPricePerUnit(
                schema::LineUpdateOperationFixedPricePerUnitAdjustment {
                    amount: Decimal(amount),
                },
            ),
        }),
        title: None,
    })
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

        if shape_type == Some("custom") {
            let gauge = parse_i64(line.gauge().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
            let girth = parse_f64(line.girth().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
            if girth <= 0.0 {
                continue;
            }
            let mut length = parse_f64(line.length().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
            if length <= 0.0 {
                length = DEFAULT_LENGTH_IN;
            }
            let bends = parse_f64(line.bends().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
            let rate = get_rate_for_gauge(gauge);
            let amount = round_cents(rate * girth * length * MATERIAL_MARKUP + bends.max(0.0) * BEND_COST);
            operations.push(line_update(line.id().clone(), amount));
            continue;
        }

        if shape_type != Some("L") {
            continue;
        }

        let l1 = parse_f64(line.l_1().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
        let l2 = parse_f64(line.l_2().as_ref().and_then(|a| a.value().map(|s| s.as_str())));
        let gauge = parse_i64(line.gauge().as_ref().and_then(|a| a.value().map(|s| s.as_str())));

        if l1 <= 0.0 || l2 <= 0.0 {
            continue;
        }

        let value = get_value_for_gauge(gauge);
        let girth = l1 + l2;
        let length_feet = 10.0;
        let unit_price = value * girth * length_feet;
        let amount = round_cents(unit_price);
        operations.push(line_update(line.id().clone(), amount));
    }

    Ok(schema::CartTransformRunResult { operations })
}
