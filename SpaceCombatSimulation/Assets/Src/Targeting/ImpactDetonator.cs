using Assets.Src.Health;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ImpactDetonator : MonoBehaviour {
    public Rigidbody DeathExplosion;

    private IDestroyer _destroyer;

    public Rigidbody Shrapnel;
    public int ShrapnelCount2 = 30;
    public float ShrapnelSpeed2 = 20;

    private Rigidbody _rigidbody;

    private bool StartCalled = false;

    // Use this for initialization
    void Start()
    {
        StartCalled = true;
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

        //if (_destroyer == null)
        //{
        //    Debug.LogWarning(gameObject + " has null destroyer");
        //    Start();
        //}
    }

    void OnCollisionEnter(Collision collision)
    {
        Vector3? velocity = null;
        if(_rigidbody != null && collision.rigidbody != null)
        {
            //Get velocity weighted by object masses, so it doesn't fly away because the projectile would have.
            var averageP = ((_rigidbody.mass * _rigidbody.velocity) + (collision.rigidbody.mass * collision.rigidbody.velocity))/2;
            velocity = (averageP / (_rigidbody.mass + collision.rigidbody.mass)) * _rigidbody.mass;
        } else if (collision.rigidbody != null)
        {
            velocity = collision.rigidbody.velocity;
            Debug.LogWarning(name + "is Missing Rigidbody");
        } else
        {
            Debug.LogWarning(name + " and " + collision.gameObject.name  + " are both Missing Rigidbody");
        }
        ExplodeNow(velocity);
    }

    /// <summary>
    /// Destroys the projectile
    /// </summary>
    /// <param name="damage"></param>
    public void ApplyDamage(float damage = 0)
    {
        //anything trying to apply damage should destroy this.
        //don't destroy it if it hasn't started yet.
        ExplodeNow();
    }

    /// <summary>
    /// Destroys the projectile
    /// </summary>
    /// <param name="damage"></param>
    public void ApplyDamage(DamagePacket damage)
    {
        ExplodeNow();
    }

    private void ExplodeNow(Vector3? velocity = null)
    {
        if (StartCalled)
        {
            if (_destroyer == null)
            {
                Debug.LogWarning(gameObject + " has null destroyer, Start called: " + StartCalled);
                Start();
            }
            _destroyer.Destroy(gameObject, true, velocity);
        }
    }
}
