use anyhow::{anyhow, Result};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

// Gamut Philips Hue standard (Gamut C - ampoules Hue White & Color Ambiance modernes)
const GAMUT_C_RED: Point = Point { x: 0.6915, y: 0.3083 };
const GAMUT_C_GREEN: Point = Point { x: 0.1700, y: 0.7000 };
const GAMUT_C_BLUE: Point = Point { x: 0.1532, y: 0.0475 };

/// Calcule le produit vectoriel pour vérifier si un point est à l'intérieur d'un triangle
fn cross_product(p1: Point, p2: Point, p3: Point) -> f32 {
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
}

/// Vérifie si un point CIE xy se trouve dans le triangle de Gamut
fn is_in_gamut(p: Point, red: Point, green: Point, blue: Point) -> bool {
    let d1 = cross_product(p, red, green);
    let d2 = cross_product(p, green, blue);
    let d3 = cross_product(p, blue, red);

    let has_neg = (d1 < 0.0) || (d2 < 0.0) || (d3 < 0.0);
    let has_pos = (d1 > 0.0) || (d2 > 0.0) || (d3 > 0.0);

    !(has_neg && has_pos)
}

/// Trouve le point projeté le plus proche sur un segment de droite [p1, p2]
fn get_closest_point_on_segment(p1: Point, p2: Point, p: Point) -> Point {
    let p1_p2 = Point { x: p2.x - p1.x, y: p2.y - p1.y };
    let p1_p = Point { x: p.x - p1.x, y: p.y - p1.y };

    let len_sq = p1_p2.x * p1_p2.x + p1_p2.y * p1_p2.y;
    if len_sq == 0.0 {
        return p1;
    }

    let t = ((p1_p.x * p1_p2.x + p1_p.y * p1_p2.y) / len_sq).clamp(0.0, 1.0);
    Point {
        x: p1.x + t * p1_p2.x,
        y: p1.y + t * p1_p2.y,
    }
}

/// Distance euclidienne au carré entre deux points
fn dist_sq(p1: Point, p2: Point) -> f32 {
    (p1.x - p2.x).powi(2) + (p1.y - p2.y).powi(2)
}

/// Clampe un point CIE xy à l'intérieur du triangle Gamut C Philips Hue
pub fn clamp_to_gamut_c(p: Point) -> Point {
    if is_in_gamut(p, GAMUT_C_RED, GAMUT_C_GREEN, GAMUT_C_BLUE) {
        return p;
    }

    let p_rg = get_closest_point_on_segment(GAMUT_C_RED, GAMUT_C_GREEN, p);
    let p_gb = get_closest_point_on_segment(GAMUT_C_GREEN, GAMUT_C_BLUE, p);
    let p_br = get_closest_point_on_segment(GAMUT_C_BLUE, GAMUT_C_RED, p);

    let d_rg = dist_sq(p, p_rg);
    let d_gb = dist_sq(p, p_gb);
    let d_br = dist_sq(p, p_br);

    if d_rg <= d_gb && d_rg <= d_br {
        p_rg
    } else if d_gb <= d_rg && d_gb <= d_br {
        p_gb
    } else {
        p_br
    }
}

/// Conversion d'une valeur hexadécimale (#RRGGBB ou RRGGBB) vers des coordonnées CIE xy (0.0..1.0)
pub fn hex_to_cie_xy(hex: &str) -> Result<(f32, f32)> {
    let clean_hex = hex.trim().trim_start_matches('#');
    if clean_hex.len() != 6 {
        return Err(anyhow!("Format hexadécimal invalide. Attendu: #RRGGBB (6 caractères)"));
    }

    let r = u8::from_str_radix(&clean_hex[0..2], 16)?;
    let g = u8::from_str_radix(&clean_hex[2..4], 16)?;
    let b = u8::from_str_radix(&clean_hex[4..6], 16)?;

    Ok(rgb_to_cie_xy(r, g, b))
}

/// Conversion RGB 8 bits vers coordonnées CIE xy avec correction gamma et clamping Gamut C
pub fn rgb_to_cie_xy(r: u8, g: u8, b: u8) -> (f32, f32) {
    // 1. Normalisation [0.0, 1.0]
    let r_norm = (r as f32) / 255.0;
    let g_norm = (g as f32) / 255.0;
    let b_norm = (b as f32) / 255.0;

    // 2. Inverse Gamma correction (sRGB vers Linear RGB)
    let r_lin = if r_norm > 0.04045 { ((r_norm + 0.055) / 1.055).powf(2.4) } else { r_norm / 12.92 };
    let g_lin = if g_norm > 0.04045 { ((g_norm + 0.055) / 1.055).powf(2.4) } else { g_norm / 12.92 };
    let b_lin = if b_norm > 0.04045 { ((b_norm + 0.055) / 1.055).powf(2.4) } else { b_lin_func(b_norm) };

    fn b_lin_func(val: f32) -> f32 {
        if val > 0.04045 { ((val + 0.055) / 1.055).powf(2.4) } else { val / 12.92 }
    }

    // 3. Matrice de transformation RGB vers CIE XYZ (Wide RGB D65)
    let x_val = r_lin * 0.4124 + g_lin * 0.3576 + b_lin * 0.1805;
    let y_val = r_lin * 0.2126 + g_lin * 0.7152 + b_lin * 0.0722;
    let z_val = r_lin * 0.0193 + g_lin * 0.1192 + b_lin * 0.9505;

    let sum = x_val + y_val + z_val;
    if sum == 0.0 {
        return (GAMUT_C_RED.x, GAMUT_C_RED.y);
    }

    let xy = Point {
        x: x_val / sum,
        y: y_val / sum,
    };

    // 4. Clamping dans le Gamut Philips
    let clamped = clamp_to_gamut_c(xy);
    (clamped.x, clamped.y)
}

/// Conversion inverse de coordonnées CIE xy + luminosité (0-100%) vers sRGB Hex (#RRGGBB)
pub fn cie_xy_to_hex(x: f32, y: f32, brightness_pct: f32) -> String {
    let (r, g, b) = cie_xy_to_rgb(x, y, brightness_pct);
    format!("#{:02X}{:02X}{:02X}", r, g, b)
}

/// Conversion inverse de coordonnées CIE xy + luminosité vers RGB 8-bits
pub fn cie_xy_to_rgb(x: f32, y: f32, brightness_pct: f32) -> (u8, u8, u8) {
    if y == 0.0 {
        return (0, 0, 0);
    }

    let clamped = clamp_to_gamut_c(Point { x, y });
    let x = clamped.x;
    let y = clamped.y;

    let brightness = (brightness_pct / 100.0).clamp(0.01, 1.0);

    // 1. Calcul du vecteur CIE XYZ
    let y_val = brightness;
    let x_val = (y_val / y) * x;
    let z_val = (y_val / y) * (1.0 - x - y);

    // 2. Matrice inverse XYZ vers sRGB linéaire (D65)
    let mut r_lin = x_val * 3.2406 - y_val * 1.5372 - z_val * 0.4986;
    let mut g_lin = -x_val * 0.9689 + y_val * 1.8758 + z_val * 0.0415;
    let mut b_lin = x_val * 0.0557 - y_val * 0.2040 + z_val * 1.0570;

    r_lin = r_lin.clamp(0.0, 1.0);
    g_lin = g_lin.clamp(0.0, 1.0);
    b_lin = b_lin.clamp(0.0, 1.0);

    // 3. Gamma companding (Linear RGB vers sRGB)
    let r_comp = if r_lin <= 0.0031308 { 12.92 * r_lin } else { 1.055 * r_lin.powf(1.0 / 2.4) - 0.055 };
    let g_comp = if g_lin <= 0.0031308 { 12.92 * g_lin } else { 1.055 * g_lin.powf(1.0 / 2.4) - 0.055 };
    let b_comp = if b_lin <= 0.0031308 { 12.92 * b_lin } else { 1.055 * b_lin.powf(1.0 / 2.4) - 0.055 };

    let r_u8 = (r_comp.clamp(0.0, 1.0) * 255.0).round() as u8;
    let g_u8 = (g_comp.clamp(0.0, 1.0) * 255.0).round() as u8;
    let b_u8 = (b_comp.clamp(0.0, 1.0) * 255.0).round() as u8;

    (r_u8, g_u8, b_u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_to_cie_xy_and_back() {
        let hex = "#FF0000"; // Pure red
        let (x, y) = hex_to_cie_xy(hex).expect("Conversion valide");
        assert!(x > 0.60 && y > 0.30);

        let recovered_hex = cie_xy_to_hex(x, y, 100.0);
        assert!(!recovered_hex.is_empty());
    }

    #[test]
    fn test_clamping_to_gamut() {
        // Point volontairement hors Gamut
        let outside = Point { x: 0.9, y: 0.9 };
        let clamped = clamp_to_gamut_c(outside);
        assert!(clamped.x <= GAMUT_C_RED.x);
    }
}
