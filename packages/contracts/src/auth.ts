// Acceso: registro, login, sesión. Documento 02, §3.1.
import { z } from 'zod';
import { AccountStatus, Locale, MemberRole, ProfileStatus } from './enums.js';
import { Id } from './common.js';
import { PASSWORD_MIN } from './validators.js';

export const Email = z
  .email()
  .max(254)
  .transform((e) => e.toLowerCase());
export const Password = z.string().min(PASSWORD_MIN).max(200);

/** Registro (RF-104). Nunca concede rol (RN-25). `passwordConfirm` lo comprueba la web y la API por igual. */
export const RegisterRequest = z
  .strictObject({
    email: Email,
    password: Password,
    passwordConfirm: z.string(),
    displayName: z.string().trim().min(1).max(120),
    inviteCode: z.string().trim().min(10).max(64),
    locale: Locale.default('es'),
  })
  .refine((v) => v.password === v.passwordConfirm, { path: ['passwordConfirm'], message: 'Las contraseñas no coinciden' });

/** Siempre 202 con este cuerpo, exista o no el correo y sea válido o no el código; los fallos deterministas devuelven REGISTRATION_FAILED. */
export const RegisterResponse = z.strictObject({ status: z.literal('received') });

export const LoginRequest = z.strictObject({ email: Email, password: z.string().min(1).max(200) });

/** A dónde debe llevar la web tras iniciar sesión (documento 02, §3.1). */
export const NextStep = z.enum(['home', 'complete-profile', 'awaiting-approval']);

export const SessionUser = z.strictObject({
  id: Id,
  email: z.string(),
  displayName: z.string(),
  locale: Locale,
  accountStatus: AccountStatus,
  organization: z.strictObject({ id: Id, name: z.string() }).nullable(), // null mientras está pendiente
  role: MemberRole.nullable(), // null mientras está pendiente
  profileStatus: ProfileStatus.nullable(), // solo rescatistas
  nextStep: NextStep,
});

export const LoginResponse = z.strictObject({ user: SessionUser, csrfToken: z.string() });
export const MeResponse = z.strictObject({ user: SessionUser, csrfToken: z.string() });

export const ChangePasswordRequest = z
  .strictObject({ currentPassword: z.string().min(1).max(200), newPassword: Password })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'La nueva contraseña debe ser distinta' });

export const UpdateMeRequest = z
  .strictObject({ displayName: z.string().trim().min(1).max(120).optional(), locale: Locale.optional() })
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un campo');

// ----- Recuperar contraseña (Q-33, resuelta): correo transaccional detrás del puerto Mailer y tabla password_resets (migración 0009).
export const ForgotPasswordRequest = z.strictObject({ email: Email });
export const ResetPasswordRequest = z.strictObject({ token: z.string().min(20).max(200), newPassword: Password });
