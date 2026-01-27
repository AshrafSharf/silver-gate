const BASE_URL = '/api';

async function request(method, endpoint, data = null) {
  const token = localStorage.getItem('token');

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  };

  if (data) {
    config.body = JSON.stringify(data);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, config);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Request failed');
  }

  return json;
}

export const api = {
  get: (endpoint) => request('GET', endpoint),
  post: (endpoint, data) => request('POST', endpoint, data),
  put: (endpoint, data) => request('PUT', endpoint, data),
  delete: (endpoint) => request('DELETE', endpoint),

  // Upload files using FormData (no JSON content-type)
  async upload(endpoint, formData) {
    const token = localStorage.getItem('token');

    const config = {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    };

    const response = await fetch(`${BASE_URL}${endpoint}`, config);
    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error || 'Upload failed');
    }

    return json;
  },
};

export default api;
