-- Initialize PropScraper Database
-- Database is already created via POSTGRES_DB env variable
-- Just ensure proper permissions
ALTER DATABASE proptech_db OWNER TO proptech;
GRANT ALL PRIVILEGES ON DATABASE proptech_db TO proptech;
