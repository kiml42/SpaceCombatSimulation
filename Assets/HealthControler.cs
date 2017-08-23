using Assets.src.targeting;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class HealthControler : MonoBehaviour
{
    /// <summary>
    ///damage = collider momentum/resistance 
    /// </summary>
    public float Resilience = 10;

    /// <summary>
    /// final damage = damage after resilience applied - armour (min of 0, obviously)
    /// </summary>
    public float Armour = 0;

    public float Health = 200;

    public Rigidbody DeathExplosion;
    public float ExplosionForce = 1000;
    public float ExplosionRadius = 1000;

    private IDestroyer _destroyer;
    
    public Rigidbody Shrapnel;
    public int ShrapnelCount = 10;
    public float ShrapnelSpeed = 100;
    public float ExplosionDamage = 10000;

    private Rigidbody _rigidbody;

    // Use this for initialization
    void Start()
    {
        _rigidbody = GetComponent<Rigidbody>();

        var exploder = new ShrapnelAndDamageExploder(_rigidbody, Shrapnel, DeathExplosion, ShrapnelCount)
        {
            ExplosionForce = ExplosionForce,
            ExplosionBaseDamage = ExplosionDamage,
            ShrapnelSpeed = ShrapnelSpeed,
            ExplosionRadius = ExplosionRadius
        };

        _destroyer = new WithChildrenDestroyer()
        {
            ExplosionEffect = DeathExplosion,
            ExplosionForce = ExplosionForce,
            ExplosionRadius = ExplosionRadius
        };
    }

    // Update is called once per frame
    void Update()
    {
        if (Health <= 0)
        {
            _destroyer.Destroy(gameObject, true);
        }
    }

    void OnCollisionEnter(Collision collision)
    {
        //Debug.Log("hit by " + collision.collider.name + ",v=" + collision.relativeVelocity + ",m=" + collision.rigidbody.mass);
        var p = collision.impulse;
        var damage = (p.magnitude / Resilience) - Armour;
        Health = Health - (Mathf.Max(0, damage));
        //Debug.Log("h=" + Health + ",d=" + damage);
    }

    /// <summary>
    /// Applys damage, ignores resistance and armour
    /// </summary>
    /// <param name="damage"></param>
    void ApplyDamage(float damage)
    {
        Health -= damage;
    }
}
