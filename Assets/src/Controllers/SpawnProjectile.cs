using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SpawnProjectile : MonoBehaviour, IKnowsEnemyTagAndtag, IDeactivatable
{
    public bool TagChildren = false;
    public Rigidbody Projectile;
    public Transform Emitter;
    private Rigidbody _spawner;
    public bool OnlyWithTargets = false;
    private ITargetDetector _detector;
    
    public float RandomStartTime = 30;
    public int MinStartTime = 30;
    private bool _active = true;


    #region EnemyTags
    public void AddEnemyTag(string newTag)
    {
        var tags = EnemyTags.ToList();
        tags.Add(newTag);
        EnemyTags = tags.Distinct().ToList();
    }

    public string GetFirstEnemyTag()
    {
        return EnemyTags.FirstOrDefault();
    }

    public void SetEnemyTags(List<string> allEnemyTags)
    {
        EnemyTags = allEnemyTags;
    }

    public List<string> GetEnemyTags()
    {
        return EnemyTags;
    }

    public List<string> EnemyTags;
    #endregion

    public Vector3 Velocity = new Vector3(0, 0, 10);
    public float RandomSpeed = 1;

    private int _reload = 0;
    public int LoadTime = 200;

    private string InactiveTag = "Untagged";

    // Use this for initialization
    void Start()
    {
        _reload = (int)(UnityEngine.Random.value * RandomStartTime) + MinStartTime;
        Emitter = Emitter ?? transform;

        if (OnlyWithTargets)
        {
            _detector = new UnityTargetDetector()
            {
                EnemyTags = EnemyTags
            };
        }

        _spawner = GetComponent("Rigidbody") as Rigidbody;
    }

    // Update is called once per frame
    void Update()
    {
        if (_active)
            if (_reload <= 0 && ShouldShoot())
            {
                var projectile = Instantiate(Projectile, Emitter.position, Emitter.rotation);

                //Debug.Log("Velocity " + Velocity);
                Vector3 velocity = Emitter.TransformVector(Velocity);
                //velocity = Velocity.magnitude * Emitter.transform.forward;
                //Debug.Log("velocity " + velocity);

                if (_spawner != null)
                {
                    velocity = velocity + _spawner.velocity;
                }

                velocity += RandomSpeed * UnityEngine.Random.insideUnitSphere;

                projectile.velocity = velocity;

                projectile.SendMessage("SetEnemyTags", EnemyTags);
                if (TagChildren) { projectile.tag = tag; }

                _reload = LoadTime;
            }
            else
            {
                _reload--;
            }
    }

    private bool ShouldShoot()
    {
        if (OnlyWithTargets)
        {
            return _detector.DetectTargets().Any();

        }
        return true;
    }

    public void Deactivate()
    {
        _active = false;
        tag = InactiveTag;
    }
}
