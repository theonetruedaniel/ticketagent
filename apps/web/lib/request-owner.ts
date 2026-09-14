import { currentIdentity } from "./auth";
import { authenticateExtension } from "./extension-auth";

export async function resolveRequestOwner(request: Request) {
  if (request.headers.has("authorization")) {
    const extension = await authenticateExtension(request);
    if (!extension) return null;
    return { userId: extension.userId, demo: extension.tokenId === "dev" };
  }
  try {
    const identity = await currentIdentity();
    return { userId: identity.id, demo: identity.demo };
  } catch {
    return null;
  }
}
