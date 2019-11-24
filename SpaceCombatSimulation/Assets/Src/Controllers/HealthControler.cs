using Assets.Src.Health;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
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

    private IDestroyer _destroyer;
    
    public Rigidbody Shrapnel;
    public int ShrapnelCount2 = 30;
    public float ShrapnelSpeed2 = 20;
    
    public float SecondsOfInvulnerability = 1;

    private Rigidbody _rigidbody;
    public float OriginalHealth;

    [Tooltip("if set, damage is passed to this object untill it is destroyed, then damage is taken by this object.")]
    public HealthControler DamageDelegate;

    [Tooltip("Objects with any of these tags will not cause damage on collision.")]
    public List<string> IgnoredTags = new List<string>
    {
        "ForceField"
    };

    [Tooltip("set this to make this heatlth controller immune to <tag><TeamTagForceFieldSuffix> as well.")]
    public string TeamTagForceFieldSuffix = "FoceField";

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

        if (!string.IsNullOrEmpty(TeamTagForceFieldSuffix))
        {
            IgnoredTags.Add(tag + TeamTagForceFieldSuffix);
        }
    }

    void FixedUpdate()
    {
        if(SecondsOfInvulnerability > 0)
        {
            SecondsOfInvulnerability -= Time.fixedDeltaTime;
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
        if (IgnoredTags.Contains(collision.transform.tag))
        {
            //Debug.Log(name + " hit ignored tag: " + collision.transform.tag);
            return;
        }
        if(SecondsOfInvulnerability > 0)
        {
            return;
        }
        //Debug.Log("hit by " + collision.collider.name + ",v=" + collision.relativeVelocity + ",m=" + collision.rigidbody.mass);
        var p = collision.impulse;
        float damage;
        if(Resilience != 0)
        {
            damage = (p.magnitude / Resilience) - Armour;
        }
        else
        {
            damage = p.magnitude - Armour;
            Debug.LogWarning("avoided div0 error");
        }
        ApplyDamage(Mathf.Max(0, damage));
        //Debug.Log("h=" + Health + ",d=" + damage);

    }

    /// <summary>
    /// Applys damage, ignores resistance and armour
    /// </summary>
    /// <param name="damage"></param>
    public void ApplyDamage(float damage)
    {
        if (SecondsOfInvulnerability > 0)
        {
            return;
        }
        if(DamageDelegate != null)
        {
            //Debug.Log("Delegating " + damage + " Damage to " + DamageDelegate.name);
            DamageDelegate.ApplyDamage(damage);

            //If this killed it, take ther rest o the damage in this one.
            damage = DamageDelegate.Health > 0 ? 0 : -DamageDelegate.Health;
            //Debug.Log(damage + "left for " + name);
        }
        Health -= damage;
    }

    /// <summary>
    /// Applys damage, ignores resistance and armour
    /// </summary>
    /// <param name="damage"></param>
    public void ApplyDamage(DamagePacket damage)
    {
        if(damage.IsAOE && DamageDelegate != null)
        {
            //Debug.Log(transform.name + " Ignoring AOE damage because it has a delegate");
        } else
        {
            ApplyDamage(damage.Damage);
        }
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
            if(OriginalHealth != 0)
            {
                return Health / OriginalHealth;
            } else
            {
                Debug.LogWarning("Avoided div0 error");
                return Health;
            }
        }
    }
}
