import api from './client';
import { ENDPOINTS } from '../constants/endpoints';

export const authApi = {
  async login(nomor_hp, pin, tenant_slug, brand_key) {
    const payload = {
      nomor_hp,
      pin,
      tenant_slug: tenant_slug || 'default',
      brand_key: brand_key || 'universal',
    };
    const res = await api.post(ENDPOINTS.LOGIN, payload);
    return res.data;
  },

  async me() {
    const res = await api.get(ENDPOINTS.ME);
    return res.data;
  },
};
