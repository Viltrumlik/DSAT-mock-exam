import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0002_seat_personal_price_seatpricechange'),
        ('classes', '0057_classroom_monthly_price_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='seat',
            name='classroom',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='billing_seats', to='classes.classroom'),
        ),
        migrations.AddConstraint(
            model_name='seat',
            constraint=models.UniqueConstraint(condition=models.Q(('classroom__isnull', False)), fields=('account', 'classroom'), name='billing_seat_one_per_class'),
        ),
    ]
