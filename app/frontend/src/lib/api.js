import { getAuthToken } from '../stores/authStore';

const BASE_URL = '/api';

/**
 * Custom API Error class to provide more context about failures
 */
class ApiError extends Error {
  constructor(message, statusCode, response) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.response = response;
  }

  get isAuthError() {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  get isNetworkError() {
    return !this.statusCode || this.statusCode >= 500;
  }
}

async function request(method, endpoint, data = null) {
  const token = getAuthToken();

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

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, config);
    const json = await response.json();

    if (!response.ok) {
      const errorMessage = json.error || 'Request failed';
      throw new ApiError(errorMessage, response.status, json);
    }

    return json;
  } catch (error) {
    // If it's already an ApiError, rethrow it
    if (error instanceof ApiError) {
      throw error;
    }

    // Network error or other fetch failure
    throw new ApiError(
      error.message || 'Network request failed',
      null,
      null
    );
  }
}

export const api = {
  get: (endpoint) => request('GET', endpoint),
  post: (endpoint, data) => request('POST', endpoint, data),
  put: (endpoint, data) => request('PUT', endpoint, data),
  delete: (endpoint) => request('DELETE', endpoint),

  // Upload files using FormData (no JSON content-type)
  async upload(endpoint, formData) {
    const token = getAuthToken();

    const config = {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    };

    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, config);
      const json = await response.json();

      if (!response.ok) {
        const errorMessage = json.error || 'Upload failed';
        throw new ApiError(errorMessage, response.status, json);
      }

      return json;
    } catch (error) {
      // If it's already an ApiError, rethrow it
      if (error instanceof ApiError) {
        throw error;
      }

      // Network error or other fetch failure
      throw new ApiError(
        error.message || 'Upload request failed',
        null,
        null
      );
    }
  },
};

export default api;
