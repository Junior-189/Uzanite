const OPEN_FOOD_FACTS_URL = 'https://world.openfoodfacts.org/api/v2/product';

export async function lookupByBarcode(barcode) {
  const result = await lookupOpenFoodFacts(barcode);
  if (result) return result;
  return null;
}

async function lookupOpenFoodFacts(barcode) {
  try {
    const res = await fetch(
      `${OPEN_FOOD_FACTS_URL}/${barcode}.json?fields=product_name,brands,categories,nutriments,images,ingredients_text`,
      { headers: { 'User-Agent': 'UZANITE/1.0 (contact@uzanite.app)' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const image = p.images?.front_url || p.selected_images?.front?.en?.[0] || null;
    return {
      name: p.product_name || '',
      description: p.brands ? `Brand: ${p.brands}` : (p.categories || ''),
      barcode: barcode,
      image: image,
      source: 'open_food_facts',
    };
  } catch {
    return null;
  }
}
