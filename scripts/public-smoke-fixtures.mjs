// Explicit, opt-in isolation for UI smokes. Never imported by application code.
// Keep menu/Turbo checks independent of the production Vitrine's availability.
export async function mockPublicServices(page) {
  if (process.env.PUBLIC_SMOKE_MOCKS !== '1') return
  await page.route('**/rest/v1/rpc/public_product_catalog', route => {
    const mode = route.request().postDataJSON()?.p_mode
    return route.fulfill({status:200,contentType:'application/json',json:
      mode === 'categories' ? [] : {groups:[],items:[],totalProducts:0,totalBrands:0}})
  })
}
