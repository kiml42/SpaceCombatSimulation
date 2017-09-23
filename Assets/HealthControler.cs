using Assets.Src.Targeting;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;

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

    private IDestroyer _destroyer;
    
    public Rigidbody Shrapnel;
    public int ShrapnelCount2 = 30;
    public float ShrapnelSpeed2 = 20;
    
    public int FramesOfInvulnerability = 1;

    private Rigidbody _rigidbody;
    public float OriginalHealth;

    // Use this for initialization
    void Start()
    {
        OriginalHealth = Health;
        _rigidbody = GetComponent<Rigidbody>();

        var exploder = new ShrapnelExploder(_rigidbody, Shrapnel, DeathExplosion, ShrapnelCount2)
        {
            ShrapnelSpeed = ShrapnelSpeed2
        };

        _destroyer = new WithChildrenDestroyer()
        {
            Exploder = exploder,
            UntagChildren = false
        };
    }

    // Update is called once per frame
    void Update()
    {
        if(FramesOfInvulnerability > 0)
        {
            FramesOfInvulnerability--;
            return;
        }
        if (Health <= 0)
        {
            //Debug.Log(transform + " is dead from lack of health");
            _destroyer.Destroy(gameObject, true);
        }
    }

    void OnCollisionEnter(Collision collision)
    {
        if(FramesOfInvulnerability > 0)
        {
            return;
        }
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
    public void ApplyDamage(float damage)
    {
        if (FramesOfInvulnerability > 0)
        {
            return;
        }
        Health -= damage;
    }

    public bool IsDamaged
    {
        get
        {
            return Health < (OriginalHealth * 0.99);
        }
    }

    /// <summary>
    /// The proportion of the original health the object still has.
    /// 0 to 1
    /// </summary>
    public float HealthProportion { get
        {
            return Health / OriginalHealth;
        } }
}
