import axios from 'axios';

// Get API URL from env, default to '/api/v1' for production reverse-proxy setups
const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.254.53:8000/api/v1';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach JWT token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor for automatic 401 token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Check if error is 401 Unauthorized and not a login request itself
    if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes('/auth/login')) {
      if (isRefreshing) {
        // If refresh is already in progress, queue the request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        // No refresh token, logout user
        handleLogout();
        isRefreshing = false;
        return Promise.reject(error);
      }

      try {
        // Call refresh token endpoint. Note: we use direct axios here to avoid interceptors loops
        const response = await axios.post(`${API_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token } = response.data;
        localStorage.setItem('access_token', access_token);
        localStorage.setItem('refresh_token', refresh_token);

        // Update auth header for the failed request
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        processQueue(null, access_token);

        isRefreshing = false;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh token failed, logout user
        processQueue(refreshError, null);
        handleLogout();
        isRefreshing = false;
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export const handleLogout = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  // Dispatch custom event to let components react to logout
  window.dispatchEvent(new Event('auth_logout'));
};
