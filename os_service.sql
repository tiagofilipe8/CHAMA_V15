--
-- PostgreSQL database dump
--

\restrict EDB8sm9LyiPFpnwuefi6cICi0S4C0TDMlmSrgGodXznmHylJaIUZbWRjinTa1RC

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id bigint NOT NULL,
    name text NOT NULL,
    parent_id bigint,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entities (
    id bigint NOT NULL,
    name text NOT NULL,
    description text,
    email text,
    phone text,
    address text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    logo text,
    sla_days integer DEFAULT 0 NOT NULL,
    sla_hours integer DEFAULT 0 NOT NULL
);


--
-- Name: entities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.entities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: entities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.entities_id_seq OWNED BY public.entities.id;


--
-- Name: inapp_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inapp_notifications (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    ticket_id bigint,
    title text NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inapp_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inapp_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inapp_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inapp_notifications_id_seq OWNED BY public.inapp_notifications.id;


--
-- Name: notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_log (
    id bigint NOT NULL,
    ticket_id bigint,
    channel text NOT NULL,
    event text NOT NULL,
    recipient text NOT NULL,
    subject text,
    status text DEFAULT 'sent'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_log_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text]))),
    CONSTRAINT notification_log_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'error'::text, 'disabled'::text, 'skipped'::text])))
);


--
-- Name: notification_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_log_id_seq OWNED BY public.notification_log.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_messages (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    user_id bigint NOT NULL,
    kind text DEFAULT 'comment'::text NOT NULL,
    content text NOT NULL,
    new_status smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ticket_messages_kind_check CHECK ((kind = ANY (ARRAY['comment'::text, 'note'::text, 'system'::text, 'approval'::text])))
);


--
-- Name: ticket_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_messages_id_seq OWNED BY public.ticket_messages.id;


--
-- Name: ticket_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_status_history (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    old_status smallint,
    new_status smallint NOT NULL,
    user_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_status_history_id_seq OWNED BY public.ticket_status_history.id;


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id bigint NOT NULL,
    number text,
    title text NOT NULL,
    description text NOT NULL,
    status smallint DEFAULT 1 NOT NULL,
    priority smallint DEFAULT 2 NOT NULL,
    category_id bigint,
    entity_id bigint NOT NULL,
    requester_id bigint NOT NULL,
    assigned_user_id bigint,
    approval_status text DEFAULT 'none'::text NOT NULL,
    approval_requested_by_id bigint,
    approval_responded_by_id bigint,
    approval_comment text,
    approval_requested_at timestamp with time zone,
    approval_responded_at timestamp with time zone,
    due_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tickets_approval_status_check CHECK ((approval_status = ANY (ARRAY['none'::text, 'pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT tickets_priority_check CHECK (((priority >= 1) AND (priority <= 4))),
    CONSTRAINT tickets_status_check CHECK (((status >= 1) AND (status <= 7)))
);


--
-- Name: tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tickets_id_seq OWNED BY public.tickets.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    role text DEFAULT 'client'::text NOT NULL,
    client_level smallint DEFAULT 1 NOT NULL,
    entity_id bigint,
    active boolean DEFAULT true NOT NULL,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_client_level_check CHECK ((client_level = ANY (ARRAY[1, 2]))),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'technician'::text, 'client'::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: entities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities ALTER COLUMN id SET DEFAULT nextval('public.entities_id_seq'::regclass);


--
-- Name: inapp_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inapp_notifications ALTER COLUMN id SET DEFAULT nextval('public.inapp_notifications_id_seq'::regclass);


--
-- Name: notification_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log ALTER COLUMN id SET DEFAULT nextval('public.notification_log_id_seq'::regclass);


--
-- Name: ticket_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_messages ALTER COLUMN id SET DEFAULT nextval('public.ticket_messages_id_seq'::regclass);


--
-- Name: ticket_status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_status_history ALTER COLUMN id SET DEFAULT nextval('public.ticket_status_history_id_seq'::regclass);


--
-- Name: tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets ALTER COLUMN id SET DEFAULT nextval('public.tickets_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categories (id, name, parent_id, active, created_at) FROM stdin;
1	Hardware	\N	t	2026-09-18 20:08:01.090958-03
2	Software	\N	t	2026-09-18 20:08:01.093448-03
3	Rede	\N	t	2026-09-18 20:08:01.094493-03
4	Suporte	\N	t	2026-09-18 20:08:01.095252-03
5	Desktop	1	t	2026-09-18 20:08:01.09593-03
6	Notebook	1	t	2026-09-18 20:08:01.0968-03
7	Impressora	1	t	2026-09-18 20:08:01.097503-03
8	Monitor / Periférico	1	t	2026-09-18 20:08:01.098219-03
9	Sistemas Corporativos	2	t	2026-09-18 20:08:01.098892-03
10	E-mail	2	t	2026-09-18 20:08:01.099428-03
11	Licenças	2	t	2026-09-18 20:08:01.101419-03
12	Internet	3	t	2026-09-18 20:08:01.102581-03
13	Wi-Fi	3	t	2026-09-18 20:08:01.103006-03
14	VPN	3	t	2026-09-18 20:08:01.103622-03
15	Acesso / Credenciais	4	t	2026-09-18 20:08:01.104008-03
16	Backup	4	t	2026-09-18 20:08:01.104271-03
17	Outros	4	t	2026-09-18 20:08:01.104619-03
\.


--
-- Data for Name: entities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.entities (id, name, description, email, phone, address, active, created_at, updated_at, logo, sla_days, sla_hours) FROM stdin;
1	Empresa Demo LTDA	Empresa de demonstracao - suporte de TI	contato@empresademo.com.br	(11) 2222-3333	Av. Paulista, 1000 - Sao Paulo/SP	t	2026-09-18 20:08:00.718126-03	2026-09-18 21:30:19.746322-03	\N	0	0
5	Revenda Contábil	Contabilidade	atendimento@revendacontabil.com.br	3134336510	Av. Waldomiro Lobo, 570 - 2º andar - Guarani, Belo Horizonte - MG, 31840-020	t	2026-09-21 10:53:58.950904-03	2026-09-21 10:53:58.950904-03	/uploads/file-1789998835107-Revenda.png	0	0
4	BEM QUE TEM	Supermercado no barreiro	tiago@orcim.com.br	31 988897721	Rua Barao Do Monte Alto, 777	t	2026-09-18 21:27:47.53611-03	2026-09-21 11:23:14.717235-03	/uploads/file-1789777663398-LOGO.png	0	0
2	Empresa Beta SA	Cliente piloto - demonstrativo	ti@empresabeta.com.br	(21) 3333-4444	Rua do Comercio, 500 - Rio de Janeiro/RJ	t	2026-09-18 20:08:00.720821-03	2026-09-21 11:29:22.295752-03	\N	0	0
\.


--
-- Data for Name: inapp_notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inapp_notifications (id, user_id, ticket_id, title, message, is_read, created_at) FROM stdin;
2	2	7	Chamado CH-2026-00007 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	f	2026-09-18 20:12:51.935768-03
6	2	8	Chamado CH-2026-00008 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	f	2026-09-18 20:12:56.980881-03
8	4	8	Chamado CH-2026-00008 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	f	2026-09-18 20:12:56.983215-03
11	4	8	Aprovação solicitada - CH-2026-00008	O chamado CH-2026-00008 - "Erro no sistema financeiro" aguarda sua aprovação da solução proposta.\n\nAcesse o sistema para aprovar ou reprovar.	f	2026-09-18 20:12:56.997628-03
13	2	8	Solução APROVADA - CH-2026-00008	Carlos Pereira (Gestor) aprovou a solução do chamado CH-2026-00008 - "Erro no sistema financeiro".	f	2026-09-18 20:13:53.422437-03
16	2	8	Nova mensagem em CH-2026-00008	Carlos Pereira (Gestor) escreveu: Instrucao: pontos de rede do 2o andar devem ficar no mesmo patch panel.	f	2026-09-18 20:14:56.409784-03
19	2	8	Status do chamado CH-2026-00008 alterado para Em andamento	O chamado undefined - "undefined" teve o status alterado para Em andamento.	f	2026-09-18 20:15:40.992773-03
23	2	9	Chamado CH-2026-00009 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	f	2026-09-18 20:44:59.122454-03
25	4	9	Chamado CH-2026-00009 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	f	2026-09-18 20:44:59.127981-03
5	3	8	Chamado aberto com sucesso	Seu chamado foi registrado. Número: undefined\nTítulo: undefined\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	t	2026-09-18 20:12:52.145085-03
7	3	8	Chamado CH-2026-00008 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	t	2026-09-18 20:12:56.982168-03
10	3	8	Aprovação solicitada - CH-2026-00008	O chamado CH-2026-00008 - "Erro no sistema financeiro" aguarda sua aprovação da solução proposta.\n\nAcesse o sistema para aprovar ou reprovar.	t	2026-09-18 20:12:56.996656-03
14	3	8	Solução APROVADA - CH-2026-00008	Carlos Pereira (Gestor) aprovou a solução do chamado CH-2026-00008 - "Erro no sistema financeiro".	t	2026-09-18 20:13:53.427636-03
17	3	8	Nova mensagem em CH-2026-00008	Carlos Pereira (Gestor) escreveu: Instrucao: pontos de rede do 2o andar devem ficar no mesmo patch panel.	t	2026-09-18 20:14:56.415522-03
1	1	7	Chamado aberto com sucesso	Seu chamado foi registrado. Número: undefined\nTítulo: undefined\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	t	2026-09-18 20:12:46.108893-03
3	1	7	Chamado CH-2026-00007 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	t	2026-09-18 20:12:51.937268-03
4	1	7	Aprovação solicitada - CH-2026-00007	O chamado CH-2026-00007 - "Teste de abertura via API" aguarda sua aprovação da solução proposta.\n\nAcesse o sistema para aprovar ou reprovar.	t	2026-09-18 20:12:51.974903-03
9	1	8	Chamado CH-2026-00008 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	t	2026-09-18 20:12:56.983966-03
34	2	13	Chamado CH-2026-00013 atribuído	O chamado CH-2026-00013 - "chamado teste not" foi atribuído ao técnico João da Silva (Técnico).	f	2026-09-19 16:09:21.013507-03
35	6	13	Nova mensagem em CH-2026-00013	João da Silva (Técnico) escreveu: Será agendado para dia x	f	2026-09-19 16:09:24.413883-03
36	6	13	Chamado CH-2026-00013 atribuído	O chamado CH-2026-00013 - "chamado teste not" foi atribuído ao técnico João da Silva (Técnico).	f	2026-09-19 16:09:25.009013-03
38	6	13	Aprovação solicitada - CH-2026-00013	O chamado CH-2026-00013 - "chamado teste not" aguarda sua aprovação da solução proposta.\n\nAcesse o sistema para aprovar ou reprovar.	f	2026-09-19 16:10:27.059687-03
40	2	13	Solução REPROVADA - CH-2026-00013	RICARDO reprovou a solução do chamado CH-2026-00013 - "chamado teste not".	f	2026-09-19 16:11:14.819882-03
42	6	13	Aprovação solicitada - CH-2026-00013	O chamado CH-2026-00013 - "chamado teste not" aguarda sua aprovação da solução proposta.\n\nAcesse o sistema para aprovar ou reprovar.	f	2026-09-19 16:11:51.882491-03
44	2	13	Solução APROVADA - CH-2026-00013	RICARDO aprovou a solução do chamado CH-2026-00013 - "chamado teste not".	f	2026-09-19 16:12:17.454991-03
20	3	8	Status do chamado CH-2026-00008 alterado para Em andamento	O chamado undefined - "undefined" teve o status alterado para Em andamento.	t	2026-09-18 20:15:40.999833-03
22	3	9	Chamado aberto com sucesso	Seu chamado foi registrado. Número: undefined\nTítulo: undefined\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	t	2026-09-18 20:43:56.495918-03
24	3	9	Chamado CH-2026-00009 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	t	2026-09-18 20:44:59.12609-03
27	3	10	Chamado aberto com sucesso	Seu chamado foi registrado. Número: undefined\nTítulo: undefined\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	t	2026-09-18 20:51:54.968675-03
45	6	14	Chamado aberto com sucesso	Seu chamado foi registrado. Número: CH-2026-00014\nTítulo: TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TI\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-19 16:47:25.669191-03
46	6	15	Chamado aberto com sucesso	Seu chamado foi registrado. Número: CH-2026-00015\nTítulo: teste teste\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-21 09:27:01.868734-03
47	6	16	Chamado aberto com sucesso	Seu chamado foi registrado. Número: CH-2026-00016\nTítulo: *Teste 3*\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-21 09:29:58.859007-03
28	4	11	Chamado aberto com sucesso	Seu chamado foi registrado. Número: undefined\nTítulo: undefined\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-18 21:12:08.235063-03
29	6	12	Chamado aberto com sucesso	Seu chamado foi registrado. Número: undefined\nTítulo: undefined\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-19 14:30:43.395039-03
30	6	12	Nova mensagem em CH-2026-00012	Administrador do Sistema escreveu: Teste de notifica��o WhatsApp - envio autom�tico.	f	2026-09-19 14:38:01.734957-03
31	6	13	Chamado aberto com sucesso	Seu chamado foi registrado. Número: CH-2026-00013\nTítulo: chamado teste not\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-19 16:05:58.349697-03
33	1	13	Nova mensagem em CH-2026-00013	João da Silva (Técnico) escreveu: Será agendado para dia x	t	2026-09-19 16:09:20.412419-03
37	1	13	Aprovação solicitada - CH-2026-00013	O chamado CH-2026-00013 - "chamado teste not" aguarda sua aprovação da solução proposta.\n\nAcesse o sistema para aprovar ou reprovar.	t	2026-09-19 16:10:23.045757-03
12	1	8	Aprovação solicitada - CH-2026-00008	O chamado CH-2026-00008 - "Erro no sistema financeiro" aguarda sua aprovação da solução proposta.\n\nAcesse o sistema para aprovar ou reprovar.	t	2026-09-18 20:12:56.998479-03
15	1	8	Solução APROVADA - CH-2026-00008	Carlos Pereira (Gestor) aprovou a solução do chamado CH-2026-00008 - "Erro no sistema financeiro".	t	2026-09-18 20:13:53.429338-03
18	1	8	Nova mensagem em CH-2026-00008	Carlos Pereira (Gestor) escreveu: Instrucao: pontos de rede do 2o andar devem ficar no mesmo patch panel.	t	2026-09-18 20:14:56.417544-03
21	1	8	Status do chamado CH-2026-00008 alterado para Em andamento	O chamado undefined - "undefined" teve o status alterado para Em andamento.	t	2026-09-18 20:15:41.002859-03
26	1	9	Chamado CH-2026-00009 atribuído	O chamado undefined - "undefined" foi atribuído ao técnico .	t	2026-09-18 20:44:59.12999-03
39	1	13	Solução REPROVADA - CH-2026-00013	RICARDO reprovou a solução do chamado CH-2026-00013 - "chamado teste not".	t	2026-09-19 16:11:10.800507-03
41	1	13	Aprovação solicitada - CH-2026-00013	O chamado CH-2026-00013 - "chamado teste not" aguarda sua aprovação da solução proposta.\n\nAcesse o sistema para aprovar ou reprovar.	t	2026-09-19 16:11:47.87427-03
43	1	13	Solução APROVADA - CH-2026-00013	RICARDO aprovou a solução do chamado CH-2026-00013 - "chamado teste not".	t	2026-09-19 16:12:13.432665-03
32	1	13	Chamado CH-2026-00013 atribuído	O chamado CH-2026-00013 - "chamado teste not" foi atribuído ao técnico João da Silva (Técnico).	t	2026-09-19 16:09:17.004083-03
48	1	17	Chamado aberto com sucesso	Seu chamado foi registrado. Número: CH-2026-00017\nTítulo: *teste bqt*\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-21 10:59:26.26672-03
49	3	18	Chamado aberto com sucesso	Seu chamado foi registrado. Número: CH-2026-00018\nTítulo: *teste*\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-21 11:11:28.90421-03
50	1	19	Chamado aberto com sucesso	Seu chamado foi registrado. Número: CH-2026-00019\nTítulo: *Teste SLA*\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.	f	2026-09-21 11:23:01.472136-03
51	6	19	Chamado CH-2026-00019 — Fechado	O chamado CH-2026-00019 - "Teste SLA" foi *fechado*. Obrigado pelo contato!	f	2026-09-21 11:23:05.789623-03
52	12	19	Chamado CH-2026-00019 — Fechado	O chamado CH-2026-00019 - "Teste SLA" foi *fechado*. Obrigado pelo contato!	f	2026-09-21 11:23:06.191125-03
\.


--
-- Data for Name: notification_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notification_log (id, ticket_id, channel, event, recipient, subject, status, error, created_at) FROM stdin;
1	7	email	ticket.created.confirmation	admin@empresa.ti	Chamado CH-2026-00007 aberto	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:46.11325-03
2	7	email	ticket.assigned	joao@empresa.ti	[Atribuído] CH-2026-00007 - Teste de abertura via API	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:51.936704-03
3	7	email	ticket.assigned	admin@empresa.ti	[Atribuído] CH-2026-00007 - Teste de abertura via API	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:51.938033-03
4	7	email	approval.requested	admin@empresa.ti	[Aprovação] CH-2026-00007 - Teste de abertura via API	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:51.976002-03
5	8	email	ticket.created.confirmation	maria@empresademo.com.br	Chamado CH-2026-00008 aberto	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:52.145834-03
6	8	email	ticket.assigned	joao@empresa.ti	[Atribuído] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:56.981604-03
7	8	email	ticket.assigned	maria@empresademo.com.br	[Atribuído] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:56.982868-03
8	8	email	ticket.assigned	carlos@empresademo.com.br	[Atribuído] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:56.983608-03
9	8	email	ticket.assigned	admin@empresa.ti	[Atribuído] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:56.984465-03
10	8	email	approval.requested	maria@empresademo.com.br	[Aprovação] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:56.997247-03
11	8	email	approval.requested	carlos@empresademo.com.br	[Aprovação] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:56.998139-03
12	8	email	approval.requested	admin@empresa.ti	[Aprovação] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:12:56.998908-03
13	8	email	approval.responded	joao@empresa.ti	[Aprovado] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:13:53.425715-03
14	8	email	approval.responded	maria@empresademo.com.br	[Aprovado] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:13:53.428655-03
15	8	email	approval.responded	admin@empresa.ti	[Aprovado] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:13:53.430243-03
16	8	email	comment.added	joao@empresa.ti	[Mensagem] CH-2026-00008	error	SMTP não configurado no arquivo .env	2026-09-18 20:14:56.413282-03
17	8	email	comment.added	maria@empresademo.com.br	[Mensagem] CH-2026-00008	error	SMTP não configurado no arquivo .env	2026-09-18 20:14:56.416639-03
18	8	email	comment.added	admin@empresa.ti	[Mensagem] CH-2026-00008	error	SMTP não configurado no arquivo .env	2026-09-18 20:14:56.418608-03
19	8	email	status.changed	joao@empresa.ti	[Em andamento] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:15:40.996289-03
20	8	email	status.changed	maria@empresademo.com.br	[Em andamento] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:15:41.00111-03
21	8	email	status.changed	admin@empresa.ti	[Em andamento] CH-2026-00008 - Erro no sistema financeiro	error	SMTP não configurado no arquivo .env	2026-09-18 20:15:41.004937-03
22	9	email	ticket.created.confirmation	maria@empresademo.com.br	Chamado CH-2026-00009 aberto	error	SMTP não configurado no arquivo .env	2026-09-18 20:43:56.498579-03
23	9	email	ticket.assigned	joao@empresa.ti	[Atribuído] CH-2026-00009 - computador parou de funcionar	error	SMTP não configurado no arquivo .env	2026-09-18 20:44:59.124218-03
24	9	email	ticket.assigned	maria@empresademo.com.br	[Atribuído] CH-2026-00009 - computador parou de funcionar	error	SMTP não configurado no arquivo .env	2026-09-18 20:44:59.127253-03
25	9	email	ticket.assigned	carlos@empresademo.com.br	[Atribuído] CH-2026-00009 - computador parou de funcionar	error	SMTP não configurado no arquivo .env	2026-09-18 20:44:59.129098-03
26	9	email	ticket.assigned	admin@empresa.ti	[Atribuído] CH-2026-00009 - computador parou de funcionar	error	SMTP não configurado no arquivo .env	2026-09-18 20:44:59.13162-03
27	10	email	ticket.created.confirmation	maria@empresademo.com.br	Chamado CH-2026-00010 aberto	error	SMTP não configurado no arquivo .env	2026-09-18 20:51:54.970559-03
28	11	email	ticket.created.confirmation	carlos@empresademo.com.br	Chamado CH-2026-00011 aberto	error	SMTP não configurado no arquivo .env	2026-09-18 21:12:08.2375-03
29	12	email	comment.added	tiagofable@gmail.com	[Mensagem] CH-2026-00012	error	SMTP não configurado no arquivo .env	2026-09-19 14:38:01.745462-03
30	12	whatsapp	comment.added	31988897721	\N	error	No LID for user\ns (https://static.whatsapp.net/rsrc.php/v4/yL/r/6-eerGMZKhM.js:84:180)	2026-09-19 14:38:01.910692-03
31	13	email	ticket.created.confirmation	tiagofable@gmail.com	Chamado CH-2026-00013 aberto	error	SMTP não configurado no arquivo .env	2026-09-19 16:05:58.362868-03
32	13	whatsapp	ticket.created.confirmation	+5531988897721	\N	sent	\N	2026-09-19 16:05:58.744975-03
33	13	email	ticket.assigned	admin@empresa.ti	[Atribuído] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:09:17.00616-03
34	13	email	comment.added	admin@empresa.ti	[Mensagem] CH-2026-00013	error	SMTP não configurado no arquivo .env	2026-09-19 16:09:20.413587-03
35	13	whatsapp	ticket.assigned	(11) 90000-0001	\N	error	Numero (11) 90000-0001 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:09:21.012608-03
36	13	email	ticket.assigned	joao@empresa.ti	[Atribuído] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:09:21.014582-03
37	13	whatsapp	comment.added	(11) 90000-0001	\N	error	Numero (11) 90000-0001 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:09:24.412828-03
38	13	email	comment.added	tiagofable@gmail.com	[Mensagem] CH-2026-00013	error	SMTP não configurado no arquivo .env	2026-09-19 16:09:24.41489-03
39	13	whatsapp	comment.added	+5531988897721	\N	sent	\N	2026-09-19 16:09:24.606043-03
40	13	whatsapp	ticket.assigned	(11) 90000-0002	\N	error	Numero (11) 90000-0002 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:09:24.994627-03
41	13	email	ticket.assigned	tiagofable@gmail.com	[Atribuído] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:09:25.043456-03
42	13	whatsapp	ticket.assigned	+5531988897721	\N	sent	\N	2026-09-19 16:09:25.245537-03
43	13	email	approval.requested	admin@empresa.ti	[Aprovação] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:10:23.047857-03
44	13	whatsapp	approval.requested	(11) 90000-0001	\N	error	Numero (11) 90000-0001 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:10:27.058699-03
45	13	email	approval.requested	tiagofable@gmail.com	[Aprovação] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:10:27.060959-03
46	13	whatsapp	approval.requested	+5531988897721	\N	sent	\N	2026-09-19 16:10:27.247216-03
47	13	email	approval.responded	admin@empresa.ti	[Reprovado] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:11:10.802647-03
48	13	whatsapp	approval.responded	(11) 90000-0001	\N	error	Numero (11) 90000-0001 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:11:14.808477-03
49	13	email	approval.responded	joao@empresa.ti	[Reprovado] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:11:14.821327-03
50	13	whatsapp	approval.responded	(11) 90000-0002	\N	error	Numero (11) 90000-0002 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:11:18.82307-03
51	13	email	approval.requested	admin@empresa.ti	[Aprovação] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:11:47.876694-03
52	13	whatsapp	approval.requested	(11) 90000-0001	\N	error	Numero (11) 90000-0001 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:11:51.875966-03
53	13	email	approval.requested	tiagofable@gmail.com	[Aprovação] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:11:51.88379-03
54	13	whatsapp	approval.requested	+5531988897721	\N	sent	\N	2026-09-19 16:11:52.073931-03
55	13	email	approval.responded	admin@empresa.ti	[Aprovado] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:12:13.434572-03
56	13	whatsapp	approval.responded	(11) 90000-0001	\N	error	Numero (11) 90000-0001 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:12:17.448878-03
57	13	email	approval.responded	joao@empresa.ti	[Aprovado] CH-2026-00013 - chamado teste not	error	SMTP não configurado no arquivo .env	2026-09-19 16:12:17.456139-03
58	13	whatsapp	approval.responded	(11) 90000-0002	\N	error	Numero (11) 90000-0002 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-19 16:12:21.468805-03
59	14	email	ticket.created.confirmation	tiagofable@gmail.com	Chamado CH-2026-00014 aberto	error	SMTP não configurado no arquivo .env	2026-09-19 16:47:25.672039-03
60	14	whatsapp	ticket.created.confirmation	+5531988897721	\N	sent	\N	2026-09-19 16:47:26.066346-03
61	15	email	ticket.created.confirmation	tiagofable@gmail.com	Chamado CH-2026-00015 aberto	error	SMTP não configurado no arquivo .env	2026-09-21 09:27:01.886664-03
62	15	whatsapp	ticket.created.confirmation	+5531988897721	\N	sent	\N	2026-09-21 09:27:02.544212-03
63	16	email	ticket.created.confirmation	tiagofable@gmail.com	Chamado CH-2026-00016 aberto	error	SMTP não configurado no arquivo .env	2026-09-21 09:29:58.861713-03
64	16	whatsapp	ticket.created.confirmation	+5531988897721	\N	sent	\N	2026-09-21 09:30:00.381633-03
65	17	email	ticket.created.confirmation	admin@empresa.ti	Chamado CH-2026-00017 aberto	error	SMTP não configurado no arquivo .env	2026-09-21 10:59:26.2743-03
66	17	whatsapp	ticket.created.confirmation	(11) 90000-0001	\N	error	Numero (11) 90000-0001 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-21 10:59:30.312098-03
67	18	email	ticket.created.confirmation	maria@empresademo.com.br	Chamado CH-2026-00018 aberto	error	SMTP não configurado no arquivo .env	2026-09-21 11:11:28.905232-03
68	18	whatsapp	ticket.created.confirmation	(11) 988881111	\N	sent	\N	2026-09-21 11:11:29.187153-03
69	19	email	ticket.created.confirmation	admin@empresa.ti	Chamado CH-2026-00019 aberto	error	SMTP não configurado no arquivo .env	2026-09-21 11:23:01.476449-03
70	19	whatsapp	ticket.created.confirmation	(11) 90000-0001	\N	error	Numero (11) 90000-0001 nao encontrado no WhatsApp (nao possui conta ativa).	2026-09-21 11:23:05.720153-03
71	19	email	status.changed	tiagofable@gmail.com	[Fechado] CH-2026-00019 - Teste SLA	error	SMTP não configurado no arquivo .env	2026-09-21 11:23:05.791987-03
72	19	whatsapp	status.changed	+5531988897721	\N	sent	\N	2026-09-21 11:23:06.186639-03
73	19	email	status.changed	asdf	[Fechado] CH-2026-00019 - Teste SLA	error	SMTP não configurado no arquivo .env	2026-09-21 11:23:06.192769-03
74	19	whatsapp	status.changed	(31) 988897721	\N	sent	\N	2026-09-21 11:23:06.393601-03
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings (key, value, updated_at) FROM stdin;
notify.templates	{"ticket.created.confirmation":{"title":"Chamado aberto com sucesso","subject":"Chamado {{number}} aberto","message":"Seu chamado foi registrado. Número: {{number}}\\nTítulo: *{{title}}*\\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp."}}	2026-09-21 09:29:34.863741-03
app.name	Central de Serviços	2026-09-19 15:34:39.770362-03
app.logo	/uploads/file-1789774881358-LOGO1.jpg	2026-09-18 20:41:21.364539-03
app.background	/uploads/file-1789774915886-FUNDO_DE_LOGIN.jpg	2026-09-18 20:41:56.454157-03
app.notify_email	true	2026-09-19 15:34:39.770362-03
app.notify_whatsapp	true	2026-09-19 15:34:39.770362-03
app.notify_techs_new	true	2026-09-19 15:34:39.770362-03
app.notify_clients	true	2026-09-19 15:34:39.770362-03
app.approval_on_solve	true	2026-09-19 15:34:39.770362-03
app.admin_email	suporte@orcim.com.br	2026-09-19 15:34:39.770362-03
app.voice_enabled	true	2026-09-19 15:34:39.770362-03
app.voice_new_ticket	true	2026-09-19 15:34:39.770362-03
app.refresh_interval	10000	2026-09-19 15:34:39.770362-03
backup.auto_enabled	true	2026-09-19 15:34:39.770362-03
backup.auto_hour	3	2026-09-19 15:34:39.770362-03
\.


--
-- Data for Name: ticket_messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_messages (id, ticket_id, user_id, kind, content, new_status, created_at) FROM stdin;
1	1	3	comment	Notebook da recepção não liga ao apertar o botão de energia. Led pisca 3 vezes.	\N	2026-09-18 18:08:01.104-03
2	2	3	comment	Usuários do 2º andar relatam queda total de internet desde às 9h.	\N	2026-09-18 19:38:01.12-03
3	3	5	comment	Novo colaborador precisa de acesso ao módulo financeiro do ERP.	\N	2026-09-18 20:03:01.124-03
4	4	3	comment	Impressora do 1º andar apresenta erro de atolamento constante de papel.	\N	2026-09-18 17:08:01.127-03
5	5	3	comment	Outlook apresenta erro 550 ao enviar e-mails com anexos grandes.	\N	2026-09-17 20:08:01.13-03
6	6	3	comment	Renovar a instalação do Microsoft Office na estação da contabilidade.	\N	2026-09-16 20:08:01.133-03
7	7	1	comment	Chamado criado para validar o fluxo.	\N	2026-09-18 20:12:46.101066-03
8	7	1	system	Administrador do Sistema atribuiu o chamado ao técnico.	2	2026-09-18 20:12:51.931491-03
9	7	2	approval	Solicitação de aprovação enviada ao cliente.\n\nSolução proposta: Substituido HD com defeito e reinstalado o sistema.	\N	2026-09-18 20:12:51.97145-03
10	8	3	comment	Ao emitir relatorio o sistema trava.	\N	2026-09-18 20:12:52.142238-03
11	8	2	system	João da Silva (Técnico) atribuiu o chamado ao técnico.	2	2026-09-18 20:12:56.977412-03
12	8	2	approval	Solicitação de aprovação enviada ao cliente.\n\nSolução proposta: Resetada secao e atualizado certificado SSL do servidor.	\N	2026-09-18 20:12:56.99392-03
13	8	4	approval	Carlos Pereira (Gestor) APROVOU a solução proposta.\n\nAprovado. Pode fechar.	6	2026-09-18 20:13:53.414845-03
14	8	4	note	Instrucao: pontos de rede do 2o andar devem ficar no mesmo patch panel.	\N	2026-09-18 20:13:53.454321-03
15	8	4	note	Instrucao: pontos de rede do 2o andar devem ficar no mesmo patch panel.	\N	2026-09-18 20:14:56.401089-03
16	8	4	system	Carlos Pereira (Gestor) alterou o status de "Fechado" para "Em andamento".	3	2026-09-18 20:15:40.98513-03
17	9	3	comment	Preciso de ajuda para liberação	\N	2026-09-18 20:43:56.488173-03
18	9	1	system	Administrador do Sistema atribuiu o chamado ao técnico.	2	2026-09-18 20:44:59.11547-03
19	10	3	comment	tete	\N	2026-09-18 20:51:54.962402-03
20	11	4	comment	chamado do gestor	\N	2026-09-18 21:12:08.228023-03
21	12	6	comment	asdfasdf	\N	2026-09-19 14:30:43.385276-03
22	12	1	comment	Teste de notifica��o WhatsApp - envio autom�tico.	\N	2026-09-19 14:38:01.727136-03
23	13	6	comment	chamado teste not	\N	2026-09-19 16:05:58.33903-03
24	13	2	system	João da Silva (Técnico) atribuiu o chamado ao técnico.	2	2026-09-19 16:09:16.998877-03
25	13	2	comment	Será agendado para dia x	\N	2026-09-19 16:09:20.40636-03
26	13	2	approval	Solicitação de aprovação enviada ao cliente.\n\nSolução proposta: Solução aplicada foi a XYZ	\N	2026-09-19 16:10:23.041566-03
27	13	6	approval	RICARDO REPROVOU a solução proposta.	3	2026-09-19 16:11:10.796322-03
28	13	2	approval	Solicitação de aprovação enviada ao cliente.\n\nSolução proposta: Agora sim ok, tudo certo.	\N	2026-09-19 16:11:47.868778-03
29	13	6	approval	RICARDO APROVOU a solução proposta.	6	2026-09-19 16:12:13.429664-03
30	14	6	comment	DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO -	\N	2026-09-19 16:47:25.660006-03
31	15	6	comment	teste	\N	2026-09-21 09:27:01.853057-03
32	16	6	comment	teste 3	\N	2026-09-21 09:29:58.852847-03
33	17	1	comment	teste bqt	\N	2026-09-21 10:59:26.262578-03
34	18	3	comment	teste	\N	2026-09-21 11:11:28.901134-03
35	19	1	comment	Teste de SLA por entidade	\N	2026-09-21 11:23:01.462122-03
36	19	1	comment	fechando teste	6	2026-09-21 11:23:05.784559-03
\.


--
-- Data for Name: ticket_status_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_status_history (id, ticket_id, old_status, new_status, user_id, created_at) FROM stdin;
1	1	1	3	2	2026-09-18 18:08:01.104-03
2	2	1	3	2	2026-09-18 19:38:01.12-03
3	3	1	1	5	2026-09-18 20:03:01.124-03
4	4	1	2	2	2026-09-18 17:08:01.127-03
5	5	1	4	2	2026-09-17 20:08:01.13-03
6	6	1	5	2	2026-09-16 20:08:01.133-03
7	7	\N	1	1	2026-09-18 20:12:46.099248-03
8	7	1	2	1	2026-09-18 20:12:51.932048-03
9	8	\N	1	3	2026-09-18 20:12:52.141719-03
10	8	1	2	2	2026-09-18 20:12:56.977999-03
11	8	2	6	4	2026-09-18 20:13:53.41288-03
12	8	6	3	4	2026-09-18 20:15:40.983116-03
13	9	\N	1	3	2026-09-18 20:43:56.486485-03
14	9	1	2	1	2026-09-18 20:44:59.117605-03
15	10	\N	1	3	2026-09-18 20:51:54.959935-03
16	11	\N	1	4	2026-09-18 21:12:08.225915-03
17	12	\N	1	6	2026-09-19 14:30:43.382028-03
18	13	\N	1	6	2026-09-19 16:05:58.334909-03
19	13	1	2	2	2026-09-19 16:09:16.999701-03
20	13	2	3	6	2026-09-19 16:11:10.79426-03
21	13	3	6	6	2026-09-19 16:12:13.428903-03
22	14	\N	1	6	2026-09-19 16:47:25.657247-03
23	15	\N	1	6	2026-09-21 09:27:01.268626-03
24	16	\N	1	6	2026-09-21 09:29:58.850816-03
25	17	\N	1	1	2026-09-21 10:59:26.260189-03
26	18	\N	1	3	2026-09-21 11:11:28.899178-03
27	19	\N	1	1	2026-09-21 11:23:01.45988-03
28	19	1	6	1	2026-09-21 11:23:05.782836-03
\.


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tickets (id, number, title, description, status, priority, category_id, entity_id, requester_id, assigned_user_id, approval_status, approval_requested_by_id, approval_responded_by_id, approval_comment, approval_requested_at, approval_responded_at, due_at, closed_at, created_at, updated_at) FROM stdin;
1	CH-2026-00101	Notebook não liga	Notebook da recepção não liga ao apertar o botão de energia. Led pisca 3 vezes.	3	3	6	1	3	2	none	\N	\N	\N	\N	\N	\N	\N	2026-09-18 18:08:01.104-03	2026-09-18 20:08:01.119025-03
2	CH-2026-00102	Sem acesso à internet	Usuários do 2º andar relatam queda total de internet desde às 9h.	3	4	12	1	3	2	none	\N	\N	\N	\N	\N	\N	\N	2026-09-18 19:38:01.12-03	2026-09-18 20:08:01.123348-03
3	CH-2026-00103	Solicitação de acesso ao ERP	Novo colaborador precisa de acesso ao módulo financeiro do ERP.	1	2	9	2	5	\N	none	\N	\N	\N	\N	\N	\N	\N	2026-09-18 20:03:01.124-03	2026-09-18 20:08:01.127033-03
4	CH-2026-00104	Impressora com atolamento	Impressora do 1º andar apresenta erro de atolamento constante de papel.	2	2	7	1	3	2	none	\N	\N	\N	\N	\N	\N	\N	2026-09-18 17:08:01.127-03	2026-09-18 20:08:01.130262-03
5	CH-2026-00105	Erro ao enviar e-mail	Outlook apresenta erro 550 ao enviar e-mails com anexos grandes.	4	2	10	1	3	2	none	\N	\N	\N	\N	\N	\N	\N	2026-09-17 20:08:01.13-03	2026-09-18 20:08:01.13317-03
6	CH-2026-00106	Instalação de licença do Office	Renovar a instalação do Microsoft Office na estação da contabilidade.	5	1	11	1	3	2	none	\N	\N	\N	\N	\N	\N	\N	2026-09-16 20:08:01.133-03	2026-09-18 20:08:01.135185-03
7	CH-2026-00007	Teste de abertura via API	Chamado criado para validar o fluxo.	2	3	11	2	1	2	pending	2	\N	Substituido HD com defeito e reinstalado o sistema.	2026-09-18 20:12:51.97033-03	\N	\N	\N	2026-09-18 20:12:46.095642-03	2026-09-18 20:12:51.97033-03
8	CH-2026-00008	Erro no sistema financeiro	Ao emitir relatorio o sistema trava.	3	4	10	1	3	2	approved	2	4	Aprovado. Pode fechar.	2026-09-18 20:12:56.992915-03	2026-09-18 20:13:53.4116-03	\N	\N	2026-09-18 20:12:52.140249-03	2026-09-18 20:15:40.9818-03
9	CH-2026-00009	computador parou de funcionar	Preciso de ajuda para liberação	2	2	11	1	3	2	none	\N	\N	\N	\N	\N	2026-09-19 20:43:00-03	\N	2026-09-18 20:43:56.471143-03	2026-09-18 20:44:59.109044-03
10	CH-2026-00010	teste	tete	1	2	\N	1	3	\N	none	\N	\N	\N	\N	\N	\N	\N	2026-09-18 20:51:54.951008-03	2026-09-18 20:51:54.956847-03
11	CH-2026-00011	chamado do gestor	chamado do gestor	1	2	\N	1	4	\N	none	\N	\N	\N	\N	\N	\N	\N	2026-09-18 21:12:08.221507-03	2026-09-18 21:12:08.223914-03
12	CH-2026-00012	asdfasdf	asdfasdf	1	3	11	4	6	\N	none	\N	\N	\N	\N	\N	2026-09-30 18:33:00-03	\N	2026-09-19 14:30:43.367044-03	2026-09-19 14:30:43.374614-03
13	CH-2026-00013	chamado teste not	chamado teste not	6	2	\N	4	6	2	approved	2	6		2026-09-19 16:11:47.862687-03	2026-09-19 16:12:13.425775-03	\N	2026-09-19 16:12:13.425-03	2026-09-19 16:05:58.321592-03	2026-09-19 16:12:13.425775-03
14	CH-2026-00014	TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TITULO - TI	DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO - DESCRIÇÃO -	1	2	\N	4	6	\N	none	\N	\N	\N	\N	\N	\N	\N	2026-09-19 16:47:25.643108-03	2026-09-19 16:47:25.650177-03
15	CH-2026-00015	teste teste	teste	1	2	\N	4	6	\N	none	\N	\N	\N	\N	\N	\N	\N	2026-09-21 09:27:01.26404-03	2026-09-21 09:27:01.266225-03
16	CH-2026-00016	Teste 3	teste 3	1	2	\N	4	6	\N	none	\N	\N	\N	\N	\N	\N	\N	2026-09-21 09:29:58.847305-03	2026-09-21 09:29:58.84857-03
17	CH-2026-00017	teste bqt	teste bqt	1	2	\N	4	1	\N	none	\N	\N	\N	\N	\N	\N	\N	2026-09-21 10:59:26.253113-03	2026-09-21 10:59:26.257587-03
18	CH-2026-00018	teste	teste	1	2	\N	4	3	\N	none	\N	\N	\N	\N	\N	\N	\N	2026-09-21 11:11:28.894446-03	2026-09-21 11:11:28.896695-03
19	CH-2026-00019	Teste SLA	Teste de SLA por entidade	6	2	\N	4	1	\N	none	\N	\N	\N	\N	\N	2026-09-23 15:23:01.451-03	2026-09-21 11:23:05.78-03	2026-09-21 11:23:01.451693-03	2026-09-21 11:23:05.780789-03
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, password_hash, name, email, phone, role, client_level, entity_id, active, last_login, created_at, updated_at) FROM stdin;
5	cliente2	$2a$10$VCqFH3ZAVkbc9TveBStQZ.1HqtOd6I8FGKSmUSIlvXtIba60rqQMu	Ana Lima (Requisitante)	ana@empresabeta.com.br	(21) 97777-0001	client	1	2	t	\N	2026-09-18 20:08:01.089259-03	2026-09-18 21:38:38.19007-03
6	ricardo	$2a$10$f4fI76N/TkUsSoUDN5wmaOK2s5EkYAoDMboaHxIrZTMTvY9k7J.fi	RICARDO	tiagofable@gmail.com	+5531988897721	client	2	4	t	2026-09-22 16:32:46.005118-03	2026-09-18 21:28:40.995773-03	2026-09-22 16:32:46.005118-03
4	gestor1	$2a$10$jQtJVa7E.j6DUdogSQh4PeoBpR109yPyOv3ZIdtTEVsEVYehi4oBi	Carlos Pereira (Gestor)	carlos@empresademo.com.br	(11) 98888-2222	client	2	1	t	2026-09-22 16:36:25.353204-03	2026-09-18 20:08:01.089259-03	2026-09-22 16:36:25.353204-03
1	admin	$2a$10$HzIwyKp9mTqMR4y8XZqOs.ht5QwZjBhpRbNzx8TCXKFfrKoPXKXLu	Administrador do Sistema	admin@empresa.ti	(11) 90000-0001	admin	1	\N	t	2026-09-22 16:36:32.639871-03	2026-09-18 20:08:01.083243-03	2026-09-22 16:36:32.639871-03
2	tecnico1	$2a$10$BQ6sOf.bnRVNp.0bsp9L4.4fbC7kQO6EvzPhf.KGGrrFoNzIl8uv2	João da Silva (Técnico)	joao@empresa.ti	(11) 900000002	technician	1	\N	t	2026-09-22 16:39:21.154809-03	2026-09-18 20:08:01.088327-03	2026-09-22 16:39:21.154809-03
3	cliente1	$2a$10$idXAcxWHIm7IzV8byWeId.8G5LWRVll2o3mRtIw8JvQxUYnJ1ORAW	Maria Souza (Requisitante)	maria@empresademo.com.br	(11) 988881111	client	1	4	t	2026-09-21 10:39:57.425018-03	2026-09-18 20:08:01.089259-03	2026-09-21 10:39:57.425018-03
12	asdf	$2a$10$Ol7vsIK06NZVvXNAe1trgeovwuEbOwKKjI6PU5TI.RwTrCAFo3xAi	asdf	asdf	(31) 988897721	admin	1	\N	t	\N	2026-09-19 16:32:13.167939-03	2026-09-19 16:32:13.167939-03
\.


--
-- Name: categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.categories_id_seq', 17, true);


--
-- Name: entities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.entities_id_seq', 5, true);


--
-- Name: inapp_notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.inapp_notifications_id_seq', 52, true);


--
-- Name: notification_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notification_log_id_seq', 74, true);


--
-- Name: ticket_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ticket_messages_id_seq', 36, true);


--
-- Name: ticket_status_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ticket_status_history_id_seq', 28, true);


--
-- Name: tickets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tickets_id_seq', 19, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 13, true);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: entities entities_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_name_key UNIQUE (name);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: inapp_notifications inapp_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inapp_notifications
    ADD CONSTRAINT inapp_notifications_pkey PRIMARY KEY (id);


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: ticket_messages ticket_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_messages
    ADD CONSTRAINT ticket_messages_pkey PRIMARY KEY (id);


--
-- Name: ticket_status_history ticket_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_status_history
    ADD CONSTRAINT ticket_status_history_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_number_key UNIQUE (number);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_inapp_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inapp_user ON public.inapp_notifications USING btree (user_id, is_read);


--
-- Name: idx_messages_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_ticket ON public.ticket_messages USING btree (ticket_id, created_at);


--
-- Name: idx_notiflog_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notiflog_created ON public.notification_log USING btree (created_at DESC);


--
-- Name: idx_tickets_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_assigned ON public.tickets USING btree (assigned_user_id);


--
-- Name: idx_tickets_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_created ON public.tickets USING btree (created_at DESC);


--
-- Name: idx_tickets_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_entity ON public.tickets USING btree (entity_id);


--
-- Name: idx_tickets_open_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_open_status ON public.tickets USING btree (entity_id, status) WHERE (status <> ALL (ARRAY[6, 7]));


--
-- Name: idx_tickets_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_requester ON public.tickets USING btree (requester_id);


--
-- Name: idx_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_status ON public.tickets USING btree (status);


--
-- Name: idx_tickets_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_updated ON public.tickets USING btree (updated_at DESC);


--
-- Name: idx_users_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_entity ON public.users USING btree (entity_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: entities trg_entities_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_entities_touch BEFORE UPDATE ON public.entities FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: tickets trg_tickets_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tickets_touch BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: users trg_users_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_touch BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: inapp_notifications inapp_notifications_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inapp_notifications
    ADD CONSTRAINT inapp_notifications_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;


--
-- Name: inapp_notifications inapp_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inapp_notifications
    ADD CONSTRAINT inapp_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_log notification_log_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;


--
-- Name: ticket_messages ticket_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_messages
    ADD CONSTRAINT ticket_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_messages ticket_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_messages
    ADD CONSTRAINT ticket_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ticket_status_history ticket_status_history_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_status_history
    ADD CONSTRAINT ticket_status_history_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_status_history ticket_status_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_status_history
    ADD CONSTRAINT ticket_status_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: tickets tickets_approval_requested_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_approval_requested_by_id_fkey FOREIGN KEY (approval_requested_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_approval_responded_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_approval_responded_by_id_fkey FOREIGN KEY (approval_responded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: tickets tickets_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id);


--
-- Name: users users_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict EDB8sm9LyiPFpnwuefi6cICi0S4C0TDMlmSrgGodXznmHylJaIUZbWRjinTa1RC

