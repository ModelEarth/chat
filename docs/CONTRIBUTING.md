# Contributing to AI Code Chatbot

Thank you for your interest in contributing to the AI Code Chatbot project! This guide will help you get set up and understand our development workflow.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Building](#building)
- [Submitting Changes](#submitting-changes)
- [Code Standards](#code-standards)
- [Getting Help](#getting-help)

---

## Getting Started

Follow these steps to set up your local development environment.

### 1. Clone the Repository

```bash
git clone https://github.com/ananthpai1998/codechat.git
cd codechat
```

### 2. Install Dependencies

```bash
npm install
# or
pnpm install
```

### 3. Supabase Setup

You'll need your own Supabase project for local development.

#### Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for your project to be provisioned (~2 minutes)
3. Copy your project credentials from **Project Settings** → **API**:
   - Project URL
   - Anon Key (public)
   - Service Role Key (secret, for server-side operations)

#### Configure Authentication Providers

In your Supabase Dashboard:

**Email Provider (Required):**
- Navigate to **Authentication** → **Providers**
- Enable **Email** provider
- Set **Site URL**: `http://localhost:3000`
- Add **Redirect URLs**: `http://localhost:3000/**`

**GitHub OAuth (Optional):**
- See detailed instructions in [docs/settings-and-verification.md](./docs/settings-and-verification.md#github-oauth-setup)

For complete Supabase setup details, see [docs/database-design.md](./docs/database-design.md#supabase-setup).

### 4. Configure Environment Variables

The canonical sample lives at the webroot root: `automation/.env.example`. Copy it to the local env file that `automation/paths.yaml` points at (`chat/server.mjs` and `lib/env-loader.ts` read it automatically — see `automation/README.md` for how that path is set):

```bash
cp ../automation/.env.example <your local env file>
```

Update the values with your Supabase credentials:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://[YOUR-PROJECT].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[YOUR-ANON-KEY]
SUPABASE_SERVICE_ROLE_KEY=[YOUR-SERVICE-ROLE-KEY]

# Database Connection (for migrations)
POSTGRES_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres

# Application
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Important:** Never commit `.env.local` to version control. It's already in `.gitignore`.

For detailed environment variable documentation, see [docs/database-design.md](./docs/database-design.md#environment-variables).

### 5. Database Setup

Run the following commands to set up your database schema:

```bash
# Reset the database (drops all tables - use for fresh start)
npm run db:reset

# Apply all migrations (creates tables, indexes, RLS policies, seed data)
npm run db:migrate

# Verify the database setup
npm run db:verify
```

**What these commands do:**
- `db:reset` - Drops all existing tables and starts fresh
- `db:migrate` - Applies all migration files from `lib/db/migrations/`
- `db:verify` - Runs verification queries to ensure everything is set up correctly

For complete database schema documentation, see [docs/database-design.md](./docs/database-design.md).

### 6. Create an Admin User

To access the admin panel, you need to grant yourself admin privileges:

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Register a new account at `http://localhost:3000/register`

3. Go to your Supabase Dashboard → **Authentication** → **Users**

4. Find your newly created user and click the **Edit** icon

5. Update the `raw_user_meta_data` field to include admin role:
   ```json
   {
     "role": "admin",
     "isActive": true
   }
   ```

6. Save the changes

7. Refresh your browser and navigate to `http://localhost:3000/admin`

For detailed admin panel documentation, see [docs/admin-panel.md](./docs/admin-panel.md).

### 7. Start Development

Your development environment is now ready!

```bash
npm run dev
```

Visit `http://localhost:3000` to see your application running.

---

## Development Workflow

### Making Changes

1. **Create a new branch** from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our [code standards](#code-standards)

3. **Test your changes** thoroughly:
   - Run unit tests
   - Run integration tests
   - Test manually in the browser
   - Test on different screen sizes (if UI changes)

4. **Commit your changes** with clear, descriptive commit messages:
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

### Database Migrations

If your changes require database schema modifications:

1. **Update the Drizzle schema** in `lib/db/drizzle-schema.ts`

2. **Generate a migration file:**
   ```bash
   npm run db:generate
   ```

3. **Review the generated migration** in `lib/db/migrations/`

4. **Test the migration** on your local database:
   ```bash
   npm run db:migrate
   npm run db:verify
   ```

5. **Create a rollback script** (optional but recommended for complex migrations)

For detailed migration strategy, see [docs/database-design.md](./docs/database-design.md#migrations).

---

## Testing

We maintain comprehensive test coverage across unit, integration, and end-to-end tests.

### Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run end-to-end tests
npm run test:e2e

# Run all tests
npm run test:all

# Run tests in watch mode (for active development)
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Writing Tests

When adding new features or fixing bugs, always include tests:

- **Unit tests** for individual functions and components
- **Integration tests** for API routes and database operations
- **E2E tests** for complete user flows

**Test file locations:**
- Unit tests: `tests/unit/`
- Integration tests: `tests/integration/`
- E2E tests: `tests/e2e/`

For comprehensive testing documentation, see:
- [docs/testing.md](./docs/testing.md) - Testing overview and best practices
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) - Detailed testing strategy
- [docs/comprehensive-testing-structure.md](./docs/comprehensive-testing-structure.md) - Complete test structure

### Ensuring Tests Pass

**Before submitting a PR, ensure:**

1. All existing tests pass:
   ```bash
   npm run test:all
   ```

2. New tests are added for your changes

3. Test coverage hasn't decreased (check with `npm run test:coverage`)

4. No linting errors:
   ```bash
   npm run lint
   ```

---

## Building

Before submitting your PR, verify that the production build works:

```bash
npm run build
```

**Fix all build errors** before submitting. Common issues:

- **TypeScript errors**: Fix type issues in your code
- **Linting errors**: Run `npm run lint --fix` to auto-fix
- **Missing dependencies**: Ensure all imports are correct
- **Environment variables**: Check that all required env vars are documented

If the build succeeds, you'll see:

```
✓ Compiled successfully
```

Test the production build locally:

```bash
npm run start
```

---

## Submitting Changes

### 1. Push Your Branch

```bash
git push origin feature/your-feature-name
```

### 2. Create a Pull Request

1. Go to the repository on GitHub
2. Click **"New Pull Request"**
3. Select your branch
4. Fill out the PR template completely

### 3. PR Template

Our PR template (`.github/PULL_REQUEST_TEMPLATE.md`) includes:

- **Description**: Clear explanation of your changes
- **Type of Change**: Feature, bug fix, documentation, etc.
- **Database Changes**: Any schema modifications (required for DB changes)
- **Testing**: What tests you've added/run
- **Screenshots**: Visual proof of UI changes
- **Checklist**: Comprehensive pre-submission checklist

**Key items to complete:**
- [ ] All tests pass (`npm run test:all`)
- [ ] Build succeeds (`npm run build`)
- [ ] No linting errors (`npm run lint`)
- [ ] Documentation updated
- [ ] Database migration tested (if applicable)
- [ ] Screenshots provided (if UI changes)

For the complete PR template, see [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md).

### 4. Code Review

- A maintainer will review your PR
- Address any feedback or requested changes
- Once approved, your PR will be merged by a Super Admin

### 5. Deployment (Super Admin Only)

Super Admins handle production deployments:
- Applying database migrations to production
- Deploying to Vercel
- Managing production environment variables

---

## Code Standards

### TypeScript

- Use TypeScript for all new code
- Avoid `any` types - prefer `unknown` or specific types
- Define interfaces for complex objects
- Use type guards for runtime type checking

### React/Next.js

- Use React Server Components where possible
- Follow Next.js 15 App Router conventions
- Use `'use client'` directive only when necessary
- Implement proper error boundaries

### Styling

- Use Tailwind CSS for styling
- Follow existing component patterns
- Use shadcn/ui components where available
- Ensure responsive design (mobile-first)

### Database

- Always use Row Level Security (RLS) policies
- Add indexes for foreign keys and frequently queried columns
- Include verification queries in migration files
- Document schema changes in migrations

### Security

- Never expose service role keys client-side
- Validate all user inputs
- Use parameterized queries (Drizzle handles this)
- Follow OWASP security best practices
- Test RLS policies thoroughly

### Code Quality

- Run `npm run lint` before committing
- Write self-documenting code with clear variable names
- Add comments for complex logic
- Keep functions small and focused
- Follow DRY (Don't Repeat Yourself) principle

---

## Documentation

When making changes, update relevant documentation:

- **README.md**: For setup instructions or major features
- **docs/**: For detailed technical documentation
- **Code comments**: For complex algorithms or business logic
- **API docs**: For new endpoints or API changes

### Documentation Files

- [docs/admin-panel.md](./docs/admin-panel.md) - Admin dashboard features
- [docs/agent-architecture.md](./docs/agent-architecture.md) - Multi-agent system
- [docs/database-design.md](./docs/database-design.md) - Complete database schema
- [docs/multimodal-chat-features.md](./docs/multimodal-chat-features.md) - Chat system
- [docs/settings-and-verification.md](./docs/settings-and-verification.md) - API keys & settings
- [docs/testing.md](./docs/testing.md) - Testing guidelines
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) - Testing strategy
- [docs/comprehensive-testing-structure.md](./docs/comprehensive-testing-structure.md) - Test structure

---

## Getting Help

### Resources

- **Documentation**: Check the `/docs` folder for detailed guides
- **Issues**: Browse existing [GitHub Issues](https://github.com/ananthpai1998/codechat/issues)
- **Discussions**: Start a [GitHub Discussion](https://github.com/ananthpai1998/codechat/discussions)

### Questions?

- Review the documentation first
- Check if your question has been asked in Issues/Discussions
- Open a new Discussion for general questions
- Open an Issue for bugs or feature requests

### Team Structure

- **Super Admins** (@Ananth, @Loren): Production access, deployment, final approvals
- **Developers**: Contribute features, bug fixes, documentation
- **Community**: Test, report issues, suggest improvements

---

## Thank You!

We appreciate your contributions to making this project better. Every contribution, no matter how small, helps improve the AI Code Chatbot for everyone.

Happy coding! 🚀...
