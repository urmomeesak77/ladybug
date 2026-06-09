<p align="center"><a href="https://laravel.com" target="_blank"><img src="https://raw.githubusercontent.com/laravel/art/master/logo-lockup/5%20SVG/2%20CMYK/1%20Full%20Color/laravel-logolockup-cmyk-red.svg" width="400" alt="Laravel Logo"></a></p>

<p align="center">
<a href="https://github.com/laravel/framework/actions"><img src="https://github.com/laravel/framework/workflows/tests/badge.svg" alt="Build Status"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/dt/laravel/framework" alt="Total Downloads"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/v/laravel/framework" alt="Latest Stable Version"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/l/laravel/framework" alt="License"></a>
</p>

## Media storage layout

All Ladybug media lives on the Laravel `public` disk under
`storage/app/public/`. This is the single canonical destination for the seeded
prototype library **and** every future image/video upload — no other location is
used. The authoritative contract is
[`specs/003-media-storage/contracts/media-layout.md`](../specs/003-media-storage/contracts/media-layout.md);
the rules below are a summary.

| Media type | Path (relative to the `public` disk) |
|------------|--------------------------------------|
| Image | `image/trash/{size}/{shard}/{code}.{ext}` |
| Video | `video/trash/{shard}/{code}.{ext}` (no size variants) |

- **`{size}`** ∈ `original, 800, 500, 300, 100` (images only; not every image has
  every variant — missing variants are never fabricated). Videos are not resized.
- **`{shard}`** = the lowercased first character of the filename, or `other` when
  that character is not `[a-z0-9]`. Keeps any one directory from holding the whole
  library. Images and videos shard identically.
- **`{ext}`** allowlist for images: `jpg, jpeg, png, gif` (case-insensitive). Any
  other file (notably `.gitignore`) is **not** media and is never copied or served.
- Path/shard/extension logic is implemented once in
  [`app/Support/MediaPath.php`](app/Support/MediaPath.php) and shared by the seed
  command and the future upload feature.

### Seeding the existing library

```bash
php artisan media:seed --source="C:\projects\trash\storage\app\public\image\trash"
```

Copies the Trashpost prototype's images into the layout above, idempotently, and
prints a verification report (per-size source-vs-dest counts, checksum mismatches,
stray files). The source path defaults to `MEDIA_SEED_SOURCE` in `.env`
(see `.env.example`). Add `--dry-run` to report without writing.

### Version control

The media payload is **user content, not source code**, and is excluded from git
by `storage/app/public/.gitignore` (`*` + `!.gitignore`). No media file under
`image/trash/` or `video/trash/` is ever staged or committed; only the layout
contract, the ignore rule, and the code/tests are.

## About Laravel

Laravel is a web application framework with expressive, elegant syntax. We believe development must be an enjoyable and creative experience to be truly fulfilling. Laravel takes the pain out of development by easing common tasks used in many web projects, such as:

- [Simple, fast routing engine](https://laravel.com/docs/routing).
- [Powerful dependency injection container](https://laravel.com/docs/container).
- Multiple back-ends for [session](https://laravel.com/docs/session) and [cache](https://laravel.com/docs/cache) storage.
- Expressive, intuitive [database ORM](https://laravel.com/docs/eloquent).
- Database agnostic [schema migrations](https://laravel.com/docs/migrations).
- [Robust background job processing](https://laravel.com/docs/queues).
- [Real-time event broadcasting](https://laravel.com/docs/broadcasting).

Laravel is accessible, powerful, and provides tools required for large, robust applications.

## Learning Laravel

Laravel has the most extensive and thorough [documentation](https://laravel.com/docs) and video tutorial library of all modern web application frameworks, making it a breeze to get started with the framework. You can also check out [Laravel Learn](https://laravel.com/learn), where you will be guided through building a modern Laravel application.

If you don't feel like reading, [Laracasts](https://laracasts.com) can help. Laracasts contains thousands of video tutorials on a range of topics including Laravel, modern PHP, unit testing, and JavaScript. Boost your skills by digging into our comprehensive video library.

## Laravel Sponsors

We would like to extend our thanks to the following sponsors for funding Laravel development. If you are interested in becoming a sponsor, please visit the [Laravel Partners program](https://partners.laravel.com).

### Premium Partners

- **[Vehikl](https://vehikl.com)**
- **[Tighten Co.](https://tighten.co)**
- **[Kirschbaum Development Group](https://kirschbaumdevelopment.com)**
- **[64 Robots](https://64robots.com)**
- **[Curotec](https://www.curotec.com/services/technologies/laravel)**
- **[DevSquad](https://devsquad.com/hire-laravel-developers)**
- **[Redberry](https://redberry.international/laravel-development)**
- **[Active Logic](https://activelogic.com)**

## Contributing

Thank you for considering contributing to the Laravel framework! The contribution guide can be found in the [Laravel documentation](https://laravel.com/docs/contributions).

## Code of Conduct

In order to ensure that the Laravel community is welcoming to all, please review and abide by the [Code of Conduct](https://laravel.com/docs/contributions#code-of-conduct).

## Security Vulnerabilities

If you discover a security vulnerability within Laravel, please send an e-mail to Taylor Otwell via [taylor@laravel.com](mailto:taylor@laravel.com). All security vulnerabilities will be promptly addressed.

## License

The Laravel framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).
