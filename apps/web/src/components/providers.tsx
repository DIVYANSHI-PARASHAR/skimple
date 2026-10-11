"use client";
import { AuthProvider, useAuth } from "react-oidc-context";
import { createContext, ReactNode, useContext } from "react";

const authority = process.env.NEXT_PUBLIC_OIDC_AUTHORITY;
const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID;
const scope = process.env.NEXT_PUBLIC_OIDC_SCOPE || "openid profile email";
const audience = process.env.NEXT_PUBLIC_OIDC_AUDIENCE;
type Session = {
  token: string | null;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
};
const SessionContext = createContext<Session>({
  token: null,
  loading: false,
  signIn: () => {},
  signOut: () => {},
});
export const useSession = () => useContext(SessionContext);

function OidcSession({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return (
    <SessionContext.Provider
      value={{
        token: auth.user?.access_token || null,
        loading: auth.isLoading,
        signIn: () => {
          void auth.signinRedirect();
        },
        signOut: () => {
          void auth.signoutRedirect();
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  if (!authority || !clientId) {
    const dev = process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === "true";
    return (
      <SessionContext.Provider
        value={{
          token: dev ? "dev:local-user" : null,
          loading: false,
          signIn: () => {},
          signOut: () => {},
        }}
      >
        {children}
      </SessionContext.Provider>
    );
  }
  return (
    <AuthProvider
      authority={authority}
      client_id={clientId}
      redirect_uri={typeof window === "undefined" ? "" : window.location.origin}
      post_logout_redirect_uri={
        typeof window === "undefined" ? "" : window.location.origin
      }
      response_type="code"
      scope={scope}
      extraQueryParams={audience ? { audience } : undefined}
      onSigninCallback={() => {
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
      }}
    >
      <OidcSession>{children}</OidcSession>
    </AuthProvider>
  );
}
