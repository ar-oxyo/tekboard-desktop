//! Experimental complexity: which growth law fits the measured cost best.
//!
//! For each candidate model `f` (1, log n, n, n log n, n², n³, 2ⁿ) the cost is fitted as
//! `y = a·f(n) + b` by least squares (a ≥ 0), and the models are compared by the error they
//! leave. The answer is only given as "likely" when the best model clearly beats the next
//! one and enough distinct sizes were measured; otherwise it says it cannot tell. The slope
//! of log(y) against log(n) is reported too: an exponent anyone can read.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Model {
    #[serde(rename = "O(1)")]
    Constant,
    #[serde(rename = "O(log n)")]
    Log,
    #[serde(rename = "O(n)")]
    Linear,
    #[serde(rename = "O(n log n)")]
    NLogN,
    #[serde(rename = "O(n²)")]
    Quadratic,
    #[serde(rename = "O(n³)")]
    Cubic,
    #[serde(rename = "O(2ⁿ)")]
    Exponential,
}

const MODELS: [Model; 7] = [Model::Constant, Model::Log, Model::Linear, Model::NLogN, Model::Quadratic, Model::Cubic, Model::Exponential];

impl Model {
    fn f(self, n: f64) -> f64 {
        match self {
            Model::Constant => 1.0,
            Model::Log => n.max(1.0).ln(),
            Model::Linear => n,
            Model::NLogN => n * n.max(1.0).ln(),
            Model::Quadratic => n * n,
            Model::Cubic => n * n * n,
            Model::Exponential => 2f64.powf(n.min(1000.0)),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub model: Model,
    /// Coefficient of determination of `y = a·f(n) + b` (1 = perfect).
    pub r2: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fit {
    /// Best model, when the data allow a call.
    pub model: Option<Model>,
    /// `likely` (clear winner), `uncertain` (a winner, but close to the next model), or
    /// `insufficient` (fewer than four sizes, or a flat or noisy series).
    pub confidence: &'static str,
    /// Exponent `k` of `y ∝ nᵏ` from the log-log slope between the smallest and largest sizes.
    pub exponent: Option<f64>,
    pub candidates: Vec<Candidate>,
    pub why: String,
}

fn r2_of(xs: &[f64], ys: &[f64]) -> Option<f64> {
    let n = xs.len() as f64;
    let (mx, my) = (xs.iter().sum::<f64>() / n, ys.iter().sum::<f64>() / n);
    let sxx: f64 = xs.iter().map(|x| (x - mx).powi(2)).sum();
    let syy: f64 = ys.iter().map(|y| (y - my).powi(2)).sum();
    if syy <= 0.0 {
        return None;
    }
    if sxx <= 0.0 {
        // f is constant over the sizes: the model predicts the mean.
        return Some(0.0);
    }
    let sxy: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
    let a = sxy / sxx;
    if a < 0.0 {
        return Some(f64::NEG_INFINITY);
    }
    let b = my - a * mx;
    let sse: f64 = xs.iter().zip(ys).map(|(x, y)| (y - (a * x + b)).powi(2)).sum();
    Some(1.0 - sse / syy)
}

/// Fits `points` (size, cost). Costs must be positive (seconds, instructions…).
pub fn fit(points: &[(f64, f64)]) -> Fit {
    let mut pts: Vec<(f64, f64)> = points.iter().copied().filter(|(n, y)| *n > 0.0 && y.is_finite() && *y > 0.0).collect();
    pts.sort_by(|a, b| a.0.total_cmp(&b.0));
    pts.dedup_by(|a, b| a.0 == b.0);
    let exponent = match (pts.first(), pts.last()) {
        (Some(a), Some(b)) if b.0 > a.0 * 1.5 => Some((b.1.ln() - a.1.ln()) / (b.0.ln() - a.0.ln())),
        _ => None,
    };
    if pts.len() < 4 {
        return Fit { model: None, confidence: "insufficient", exponent, candidates: vec![], why: format!("{} taille(s) mesurée(s) : il en faut au moins 4 pour comparer des courbes.", pts.len()) };
    }
    let ys: Vec<f64> = pts.iter().map(|p| p.1).collect();
    let (lo, hi) = ys.iter().fold((f64::MAX, f64::MIN), |(l, h), y| (l.min(*y), h.max(*y)));
    let largest = pts.last().map(|p| p.0).unwrap_or(0.0);
    // A cost that barely moves while n grows a lot: constant (or below what can be measured).
    if hi / lo < 1.15 && largest / pts[0].0 >= 8.0 {
        return Fit { model: Some(Model::Constant), confidence: "uncertain", exponent, candidates: vec![], why: "Le coût varie de moins de 15 % alors que la taille est multipliée par au moins 8 : quasi constant, ou trop petit pour être mesuré.".into() };
    }
    let mut candidates: Vec<Candidate> = MODELS
        .iter()
        .filter(|m| **m != Model::Exponential || largest <= 64.0)
        .filter(|m| **m != Model::Constant)
        .filter_map(|m| {
            let xs: Vec<f64> = pts.iter().map(|p| m.f(p.0)).collect();
            r2_of(&xs, &ys).map(|r2| Candidate { model: *m, r2 })
        })
        .collect();
    candidates.sort_by(|a, b| b.r2.total_cmp(&a.r2));
    let Some(best) = candidates.first().cloned() else {
        return Fit { model: None, confidence: "insufficient", exponent, candidates, why: "Aucune variation mesurable.".into() };
    };
    let next = candidates.get(1).map(|c| c.r2).unwrap_or(f64::NEG_INFINITY);
    // Compare what each model leaves unexplained: a clear winner leaves much less.
    let (e_best, e_next) = ((1.0 - best.r2).max(1e-9), (1.0 - next).max(1e-9));
    let (confidence, why) = if best.r2 < 0.9 {
        ("insufficient", format!("Aucune courbe n'explique bien les mesures (meilleur R² = {:.2}) : bruit, ou coût qui dépend d'autre chose que la taille.", best.r2))
    } else if e_next / e_best >= 3.0 && best.r2 >= 0.98 {
        ("likely", format!("R² = {:.4}, nettement meilleur que le modèle suivant ({:.4}).", best.r2, next))
    } else {
        ("uncertain", format!("R² = {:.4}, proche du modèle suivant ({:.4}) : mesure plus de tailles, plus espacées.", best.r2, next))
    };
    Fit { model: (confidence != "insufficient").then_some(best.model), confidence, exponent, candidates, why }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series(f: impl Fn(f64) -> f64, sizes: &[f64], noise: f64) -> Vec<(f64, f64)> {
        sizes.iter().enumerate().map(|(i, n)| (*n, f(*n) * (1.0 + if i % 2 == 0 { noise } else { -noise }) + 0.0001)).collect()
    }

    const SIZES: [f64; 6] = [1000.0, 2000.0, 4000.0, 8000.0, 16000.0, 32000.0];

    #[test]
    fn recognises_the_usual_laws() {
        assert_eq!(fit(&series(|n| 3e-9 * n * n, &SIZES, 0.02)).model, Some(Model::Quadratic));
        assert_eq!(fit(&series(|n| 2e-8 * n, &SIZES, 0.02)).model, Some(Model::Linear));
        assert_eq!(fit(&series(|n| 1e-12 * n * n * n, &SIZES, 0.02)).model, Some(Model::Cubic));
        let nlogn = fit(&series(|n| 5e-8 * n * n.ln(), &[1e3, 1e4, 1e5, 1e6, 1e7], 0.01));
        assert_eq!(nlogn.model, Some(Model::NLogN), "{nlogn:?}");
        let quad = fit(&series(|n| 3e-9 * n * n, &SIZES, 0.0));
        assert_eq!(quad.confidence, "likely");
        assert!((quad.exponent.unwrap() - 2.0).abs() < 0.05);
        assert_eq!(fit(&series(|n| 1e-6 * 2f64.powf(n), &[10.0, 12.0, 14.0, 16.0, 18.0, 20.0], 0.01)).model, Some(Model::Exponential));
    }

    #[test]
    fn says_when_it_cannot_tell() {
        assert_eq!(fit(&[(10.0, 1.0), (20.0, 2.0), (40.0, 4.0)]).confidence, "insufficient");
        let flat = fit(&series(|_| 0.01, &SIZES, 0.02));
        assert_eq!(flat.model, Some(Model::Constant));
        let noise = fit(&[(1000.0, 5.0), (2000.0, 1.0), (4000.0, 9.0), (8000.0, 2.0), (16000.0, 7.0)]);
        assert_eq!(noise.confidence, "insufficient");
        assert!(noise.model.is_none());
    }
}
