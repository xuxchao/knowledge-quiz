import axios from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const BACKEND_HOST = import.meta.env.VITE_BACKEND_HOST || 'localhost';
const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || '3000';

const baseURL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

const instance: AxiosInstance = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

instance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

instance.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error) => {
    console.error('HTTP request error:', error);
    return Promise.reject(error);
  },
);

export const http = instance;

export default http;