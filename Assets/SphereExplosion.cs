using Assets.Src.Health;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SphereExplosion : MonoBehaviour {
    [Tooltip("Amount the collider's radius is increased each fixedUpdate")]
    public float ExpandRate;

    [Tooltip("Frames for which the collision trigger will cause damage to collited objects.")]
    public float Lifetime = 100;

    [Tooltip("optional light for the flash of the explosion")]
    public Light Light;

    private SphereCollider _collider;
    private float _intensityScaler;
    private List<Rigidbody> _previousCollisions = new List<Rigidbody>();

    [Tooltip("base force for the explosion force")]
    public float ExplosionForce = 30;
    [Tooltip("radius for the explosion force (can be larger than the radius of objects that will be touched)")]
    public float ExplosionRadius = 20;

    [Tooltip("Maximum damage from the explosion, reduced by a factor of distance squared")]
    public float ExplosionBaseDamage = 100;

    void Start()
    {
        _collider = gameObject.AddComponent<SphereCollider>();
        _collider.radius = 0;
        _collider.isTrigger = true;

        if(Light != null)
        _intensityScaler = Light.intensity/Lifetime;
    }
	
	void FixedUpdate () {
        if (_collider != null)
        {
            _collider.radius += ExpandRate;
            if (Light != null)
                Light.intensity -= _intensityScaler;
            if (Lifetime <= 0)
            {
                Destroy(_collider);
            }
        }
        if(Lifetime < -100)
        {
            Destroy(gameObject);
        }
        Lifetime--;
    }

    private void OnTriggerEnter(Collider collider)
    {
        if (!collider.isTrigger)
        {
            var rb = collider.attachedRigidbody;
            if (rb != null)
            {
                if (!_previousCollisions.Contains(rb))
                {
                    _previousCollisions.Add(rb);
                    rb.AddExplosionForce(ExplosionForce, transform.position, ExplosionRadius);

                    var hc = rb.GetComponent("HealthControler") as HealthControler;

                    if (hc != null)
                    {
                        var distance = Vector3.Distance(rb.position, transform.position);
                        var damage = distance > 1 ? ExplosionBaseDamage / (distance * distance) : ExplosionBaseDamage;

                        var packet = new DamagePacket(damage, true);
                        hc.ApplyDamage(packet);
                    }
                }
            }
        }
    }
}
