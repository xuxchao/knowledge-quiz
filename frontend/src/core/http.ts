import axios from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

export const baseURL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

const instance: AxiosInstance = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

instance.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    return config;
  },
  (error: unknown): Promise<never> => {
    return Promise.reject(new Error(String(error)));
  },
);

instance.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => {
    return response;
  },
  (error: unknown): Promise<never> => {
    console.error('HTTP request error:', error);
    return Promise.reject(new Error(String(error)));
  },
);

export const http = instance;

export default http;
