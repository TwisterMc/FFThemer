import { RendererApi } from "@shared/types";

declare global {
  interface Window {
    ffthemer: RendererApi;
  }
}

export {};
