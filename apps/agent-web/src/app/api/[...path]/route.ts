import { apiProxy } from "@/lib/api-proxy";

// Every call is forwarded as it arrives; nothing here is cached or prerendered.
export const dynamic = "force-dynamic";

export {
  apiProxy as DELETE,
  apiProxy as GET,
  apiProxy as HEAD,
  apiProxy as OPTIONS,
  apiProxy as PATCH,
  apiProxy as POST,
  apiProxy as PUT,
};
