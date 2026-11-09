/// <reference types="vite/client" />
import type { BottlecapApi } from "../../shared/api";

declare global {
  interface Window {
    bottlecap: BottlecapApi;
  }
}

export {};
