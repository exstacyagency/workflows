import { db } from "@/lib/db";
import { cfg } from "@/lib/config";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions = {
	providers: [
			CredentialsProvider({
				name: "TestSession",
				credentials: {
					token: { label: "Test Session Token", type: "text" },
				},
				async authorize(credentials, req) {
					if (cfg.isDev || cfg.MODE === "beta" || cfg.MODE === "test") {
						let token = credentials?.token;
						if (!token && req.headers?.cookie) {
							const match = req.headers.cookie.match(/test_session=([^;]+)/);
							if (match) token = match[1];
						}
						if (token) {
							const testSession = await db.testSession.findUnique({ where: { token } });
							if (testSession) {
								// Patch: Return full user object to ensure session is set
								return {
									id: testSession.userId,
									name: `TestUser-${testSession.userId}`,
									email: `test-${testSession.userId}@local.dev`,
									testSessionToken: token,
									// Mark as test user for downstream logic
									isTestUser: true,
								};
							}
						}
					}
					return null;
				},
			}),
			// Add other providers here as needed
		],
	callbacks: {
		async session({ session, token }: { session: any, token: any }) {
				if (token?.id) session.user.id = token.id;
				if (token?.isTestUser) session.user.isTestUser = true;
				if (token?.testSessionToken) session.user.testSessionToken = token.testSessionToken;
				return session;
			},
			async jwt({ token, user }: { token: any, user: any }) {
				if (user?.id) token.id = user.id;
				if (user?.isTestUser) token.isTestUser = true;
				if (user?.testSessionToken) token.testSessionToken = user.testSessionToken;
				return token;
			},
		},
};
