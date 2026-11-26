import { post, requireField, stringField } from '../server/http.js';
import { deliveryProof, limitNovaLookups, novaLookup, novaRef } from '../server/nova-poshta.js';
import { telegramUser } from '../server/telegram.js';

export default post(async (_request, response, body) => {
  const user = telegramUser(body.initData);
  const query = stringField(body.query, 80);
  limitNovaLookups(user.id);
  if (body.action === 'cities') {
    if (query.length < 2) return response.json({ options: [] });
    const settlements = await novaLookup('searchSettlements', { CityName: query, Limit: '15' });
    const addresses = settlements[0]?.Addresses;
    const options = Array.isArray(addresses) ? addresses.flatMap((address) => (
      novaRef(address?.DeliveryCity) && typeof address.Present === 'string'
        ? [{ id: address.DeliveryCity, label: address.Present }] : []
    )) : [];
    return response.json({ options: [...new Map(options.map(option => [option.id, option])).values()] });
  }
  requireField(body.action === 'branches' && novaRef(body.cityRef), 'Оберіть місто зі списку.');
  const cityRef = body.cityRef;
  const warehouses = await novaLookup('getWarehouses', { CityRef: cityRef, FindByString: query, Limit: '30', Page: '1' });
  const options = warehouses.slice(0, 30).flatMap((warehouse) => {
    const { Ref, Description, CityDescription } = warehouse;
    if (!novaRef(Ref) || typeof Description !== 'string' || !Description || typeof CityDescription !== 'string' || !CityDescription) return [];
    return [{ id: Ref, label: Description, proof: deliveryProof({ cityRef, branchRef: Ref, city: CityDescription, branch: Description }, user.id) }];
  });
  return response.json({ options });
});
