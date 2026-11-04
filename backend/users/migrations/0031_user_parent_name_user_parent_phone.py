from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0030_user_profile_image_ban_reason'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='parent_name',
            field=models.CharField(blank=True, db_default='', default='', max_length=200),
        ),
        migrations.AddField(
            model_name='user',
            name='parent_phone',
            field=models.CharField(blank=True, db_default='', default='', max_length=20),
        ),
    ]
